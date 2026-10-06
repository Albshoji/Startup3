// SPIKE (Etapa 0) — throwaway prototype of the Mapa Babel plugin.
// Wraps user functions so calls/returns can be recorded, and marks `await`
// points so the browser runtime can save/restore the logical call stack.
"use strict";

const path = require("node:path");

const SKIP = Symbol("mapa.skip");

module.exports = function mapaPlugin(api, options) {
  const t = api.types;
  const layer = options.layer; // "browser" | "server"
  const root = options.root;
  const runtimeImport = options.runtimeImport;
  const awaitsOnly = !!options.awaitsOnly;

  return {
    name: "mapa-spike",
    visitor: {
      Program: {
        enter(programPath, state) {
          const filename = state.filename;
          const relPath = path.relative(root, filename).split(path.sep).join("/");
          const defaultClass = path.basename(filename).replace(/\.[^.]+$/, "");
          const fns = [];
          const fileUseServer = programPath.node.directives.some((d) => d.value.value === "use server");

          // Pass 1: mark await points inside every async function.
          let markedAwaits = 0;
          programPath.traverse({
            Function(fnPath) {
              if (!fnPath.node.async || fnPath.node.generator) return;
              let hasAwait = false;
              fnPath.traverse({
                Function(inner) {
                  inner.skip(); // awaits of nested functions belong to them
                },
                AwaitExpression(awaitPath) {
                  if (awaitPath.node[SKIP]) return;
                  hasAwait = true;
                  markedAwaits++;
                  // __mapa.af(__mf, await __mapa.bf(X))
                  const inner = t.awaitExpression(
                    t.callExpression(mapaMember("bf"), [awaitPath.node.argument]),
                  );
                  inner[SKIP] = true;
                  awaitPath.replaceWith(
                    t.callExpression(mapaMember("af"), [t.identifier("__mf"), inner]),
                  );
                },
              });
              if (!hasAwait) return;
              ensureBlockBody(fnPath);
              fnPath.node.body.body.unshift(
                t.variableDeclaration("const", [
                  t.variableDeclarator(
                    t.identifier("__mf"),
                    t.callExpression(mapaMember("cur"), []),
                  ),
                ]),
              );
            },
          });

          if (awaitsOnly) {
            if (markedAwaits > 0) programPath.node.body.unshift(t.importDeclaration([], t.stringLiteral(runtimeImport)));
            return;
          }

          // Pass 2: wrap named functions.
          programPath.traverse({
            Function(fnPath) {
              const node = fnPath.node;
              if (node[SKIP] || node.generator) return;
              if (fnPath.isClassMethod() || fnPath.isObjectMethod()) {
                if (node.kind !== "method") return;
              }
              const info = describe(fnPath, defaultClass);
              if (!info) return;
              const loc = node.loc && node.loc.start;
              if (!loc) return;
              const index = fns.length;
              fns.push({
                id: info.name,
                klass: info.klass,
                path: relPath,
                lineno: loc.line,
                async: node.async,
                params: node.params.map(paramName),
                layer,
                labels: info.labels,
              });
              const fnUseServer =
                t.isBlockStatement(node.body) &&
                node.body.directives.some((d) => d.value.value === "use server");
              wrap(fnPath, index, fileUseServer || fnUseServer);
            },
          });

          if (fns.length === 0) return;

          // const __mapaFns = [...]  (after the import block)
          const registry = t.variableDeclaration("const", [
            t.variableDeclarator(
              t.identifier("__mapaFns"),
              api.types.valueToNode(fns),
            ),
          ]);
          const body = programPath.node.body;
          let insertAt = 0;
          while (insertAt < body.length && t.isImportDeclaration(body[insertAt])) insertAt++;
          body.splice(insertAt, 0, registry);
          body.unshift(t.importDeclaration([], t.stringLiteral(runtimeImport)));
        },
      },
    },
  };

  function mapaMember(name) {
    return t.memberExpression(
      t.memberExpression(t.identifier("globalThis"), t.identifier("__mapa")),
      t.identifier(name),
    );
  }

  function paramName(p) {
    if (t.isIdentifier(p)) return p.name;
    if (t.isAssignmentPattern(p) && t.isIdentifier(p.left)) return p.left.name;
    if (t.isRestElement(p) && t.isIdentifier(p.argument)) return p.argument.name;
    return null;
  }

  function ensureBlockBody(fnPath) {
    if (!t.isBlockStatement(fnPath.node.body)) {
      fnPath.node.body = t.blockStatement([t.returnStatement(fnPath.node.body)]);
    }
  }

  // Decide whether a function gets recorded, and under which name.
  function describe(fnPath, defaultClass) {
    const node = fnPath.node;
    const parent = fnPath.parentPath;
    const component = enclosingComponentName(fnPath);
    const labels = [];

    if (fnPath.isFunctionDeclaration()) {
      const name = node.id ? node.id.name : "default";
      if (/^[A-Z]/.test(name)) labels.push("mapa.react-component");
      return { name, klass: defaultClass, labels };
    }
    if (fnPath.isClassMethod()) {
      const cls = fnPath.parentPath.parentPath.node;
      if (!cls.id || !t.isIdentifier(node.key)) return;
      return { name: node.key.name, klass: cls.id.name, labels };
    }
    if (fnPath.isObjectMethod()) {
      if (!t.isIdentifier(node.key)) return;
      return { name: node.key.name, klass: defaultClass, labels };
    }
    // Arrow or function expression
    if (parent.isVariableDeclarator() && t.isIdentifier(parent.node.id)) {
      const name = parent.node.id.name;
      if (/^[A-Z]/.test(name)) labels.push("mapa.react-component");
      return { name, klass: defaultClass, labels };
    }
    if (parent.isExportDefaultDeclaration()) return { name: "default", klass: defaultClass, labels };
    if (parent.isObjectProperty() && t.isIdentifier(parent.node.key) && parent.node.value === node) {
      return { name: parent.node.key.name, klass: defaultClass, labels };
    }
    // Inline JSX event handler: <button onClick={() => ...}>
    if (parent.isJSXExpressionContainer() && parent.parentPath.isJSXAttribute()) {
      const attr = parent.parentPath.node.name;
      if (t.isJSXIdentifier(attr) && /^on[A-Z]/.test(attr.name)) {
        labels.push("mapa.event-handler");
        return {
          name: `${component || defaultClass}.${attr.name}@${node.loc.start.line}`,
          klass: defaultClass,
          labels,
        };
      }
    }
    // Callback given to a React hook: useEffect(() => ...), useCallback(...), useMemo(...)
    if (parent.isCallExpression() && parent.node.arguments[0] === node) {
      const callee = parent.node.callee;
      const hook = t.isIdentifier(callee) ? callee.name : t.isMemberExpression(callee) && t.isIdentifier(callee.property) ? callee.property.name : null;
      if (hook && /^use[A-Z]/.test(hook)) {
        labels.push("mapa.react-hook");
        return { name: `${component || defaultClass}.${hook}@${node.loc.start.line}`, klass: defaultClass, labels };
      }
    }
    return; // other anonymous callbacks (map, then, ...) are not recorded, like AppMap
  }

  function enclosingComponentName(fnPath) {
    const fn = fnPath.getFunctionParent && fnPath.parentPath.getFunctionParent();
    if (!fn) return;
    if (fn.node.id && t.isIdentifier(fn.node.id)) return fn.node.id.name;
    if (fn.parentPath.isVariableDeclarator() && t.isIdentifier(fn.parentPath.node.id))
      return fn.parentPath.node.id.name;
  }

  // function f(a) { body }  ->  function f(a) { return __mapa.r(this, () => { body }, arguments, __mapaFns[i]) }
  // (a) => expr             ->  (...$a) => __mapa.r(undefined, (a) => expr, $a, __mapaFns[i])
  function wrap(fnPath, index, serverAction) {
    const node = fnPath.node;
    const meta = t.memberExpression(t.identifier("__mapaFns"), t.numericLiteral(index), true);

    // Server Actions may not use `this` nor `arguments` (Next.js compile error), so the
    // original parameters move to the inner arrow and the outer function takes ...rest.
    if (serverAction && !fnPath.isArrowFunctionExpression()) {
      ensureBlockBody(fnPath);
      const body = node.body;
      const inner = t.arrowFunctionExpression(node.params, t.blockStatement(body.body, []), node.async);
      inner[SKIP] = true;
      const args = t.identifier("$mapaArgs");
      node.params = [t.restElement(args)];
      node.body = t.blockStatement(
        [t.returnStatement(t.callExpression(mapaMember("r"), [t.identifier("undefined"), inner, args, meta]))],
        body.directives,
      );
      node[SKIP] = true;
      return;
    }

    if (fnPath.isArrowFunctionExpression()) {
      const inner = t.arrowFunctionExpression(node.params, node.body, node.async);
      inner[SKIP] = true;
      const args = t.identifier("$mapaArgs");
      const outer = t.arrowFunctionExpression(
        [t.restElement(args)],
        t.callExpression(mapaMember("r"), [t.identifier("undefined"), inner, args, meta]),
        node.async,
      );
      outer[SKIP] = true;
      outer.loc = node.loc;
      fnPath.replaceWith(outer);
      return;
    }

    ensureBlockBody(fnPath);
    const body = node.body;
    const innerBody = t.blockStatement(body.body, []); // directives stay on the outer function
    const inner = t.arrowFunctionExpression([], innerBody, node.async);
    inner[SKIP] = true;
    const thisArg = fnPath.isClassMethod() || fnPath.isObjectMethod() || fnPath.isFunctionExpression() || fnPath.isFunctionDeclaration()
      ? t.thisExpression()
      : t.identifier("undefined");
    node.body = t.blockStatement(
      [
        t.returnStatement(
          t.callExpression(mapaMember("r"), [thisArg, inner, t.identifier("arguments"), meta]),
        ),
      ],
      body.directives,
    );
    node[SKIP] = true;
  }
};

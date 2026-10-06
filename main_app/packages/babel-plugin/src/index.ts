// Babel plugin that annotates the user's functions so the Mapa recorders can record each call
// and return. It is Mapa's equivalent of appmap-node's code transform
// (referencias/appmap-node/src/hooks/instrument.ts), written from scratch and adapted to code
// bundled by Next.js for the browser and the server (docs/appmap-mapping.md §1).
//
// What it does to a file:
//   - wraps each recordable function:  function f(a) { body }
//       →  function f(a) { return globalThis.__mapa.r(this, () => { body }, arguments, __mapaFns[i]) }
//   - in browser code, marks every `await` so the recorder can save and restore the logical call
//     stack (there is no AsyncLocalStorage in the browser):
//       await x  →  globalThis.__mapa.af(__mf, await globalThis.__mapa.bf(x))
//   - adds a per-file table of function metadata (`var __mapaFns = [...]`) and imports the recorder.
// TypeScript and JSX are kept as they are; Next's compiler handles them afterwards.
import { basename, extname, relative, sep } from "node:path";
import type { NodePath, PluginAPI, PluginObject, PluginPass, types as BabelTypes } from "@babel/core";
import { ConfigMatcher, type FunctionMeta, type MapaConfig } from "@mapa/format";

export type { FunctionMeta };

export type Layer = "browser" | "server";

export interface MapaBabelOptions {
  layer: Layer;
  /** Absolute path of the project root; file paths in the recording are relative to it. */
  root: string;
  /** Module the annotated file imports to install the recorder. Omitted in unit tests. */
  runtimeImport?: string;
  config?: MapaConfig;
  /**
   * Library code (supabase-js): only mark the awaits, so the browser stack survives the library's
   * own awaits before `fetch` (docs/spike-report.md, risk 2). No function is recorded.
   */
  awaitsOnly?: boolean;
}

const SKIP = Symbol("mapa.generated");
const REGISTRY = "__mapaFns";
const FRAME = "__mf";
const SUSPENDED = "__mw";
const ARGS = "$mapaArgs";
const SERVER_DIRECTIVES = new Set(["use server", "use cache", "use cache: remote", "use cache: private"]);
const ROUTE_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]);

type Generated<T> = T & { [SKIP]?: true };
type FunctionPath = NodePath<BabelTypes.Function>;

interface Description {
  name: string;
  klass: string;
  isStatic: boolean;
  labels: string[];
}

export default function mapaBabelPlugin(api: PluginAPI, options: MapaBabelOptions): PluginObject<PluginPass> {
  const t = api.types;
  const matcher = new ConfigMatcher(options.config);

  return {
    name: "mapa",
    visitor: {
      Program(programPath, state) {
        const filename = state.filename;
        if (!filename) return;
        if (options.awaitsOnly) {
          if (options.layer === "browser" && markAwaits(programPath) > 0 && options.runtimeImport) {
            programPath.node.body.unshift(
              programPath.node.sourceType === "script"
                ? t.expressionStatement(t.callExpression(t.identifier("require"), [t.stringLiteral(options.runtimeImport)]))
                : t.importDeclaration([], t.stringLiteral(options.runtimeImport)),
            );
          }
          return;
        }
        const relPath = relative(options.root, filename).split(sep).join("/");
        const pkg = matcher.matchFile(relPath);
        if (!pkg) return;

        const ext = extname(filename);
        const fileBase = basename(filename, ext);
        const allowsJsx = ext !== ".ts" && ext !== ".mts" && ext !== ".cts";
        const isRouteFile = fileBase === "route";
        const fileDirectives = programPath.node.directives.map((d) => d.value.value);
        const fileServerForm = fileDirectives.some((d) => SERVER_DIRECTIVES.has(d));
        const fileUseServer = fileDirectives.includes("use server");

        let marked = 0;
        if (options.layer === "browser") marked = markAwaits(programPath);

        const fns: FunctionMeta[] = [];
        programPath.traverse({
          Function(fnPath) {
            const node = fnPath.node as Generated<BabelTypes.Function>;
            if (node[SKIP] || node.generator || !node.loc) return;
            if ((fnPath.isClassMethod() || fnPath.isObjectMethod() || fnPath.isClassPrivateMethod()) && (node as BabelTypes.ClassMethod).kind !== "method") return;
            const info = describe(fnPath, fileBase, allowsJsx);
            if (!info || info.name.startsWith("__mapa")) return;
            if (ConfigMatcher.isFunctionExcluded(pkg, info.name, info.klass)) return;

            const bodyDirectives = t.isBlockStatement(node.body) ? node.body.directives.map((d) => d.value.value) : [];
            const serverForm = fileServerForm || bodyDirectives.some((d) => SERVER_DIRECTIVES.has(d));
            const labels = [...info.labels, ...ConfigMatcher.labelsFor(pkg, info.name, info.klass), ...commentLabels(fnPath)];
            if ((fileUseServer || bodyDirectives.includes("use server")) && node.async) labels.push("mapa.server-action");
            if (isRouteFile && ROUTE_METHODS.has(info.name) && !fnPath.getFunctionParent()) labels.push("mapa.route-handler");

            fns.push({
              id: info.name,
              klass: info.klass,
              path: relPath,
              lineno: node.loc.start.line,
              static: info.isStatic,
              async: node.async,
              // React calls components with (props, ref/legacy context); name the first one.
              params: node.params.length === 0 && info.labels.includes("mapa.react-component") ? ["props"] : node.params.map(paramName),
              labels: [...new Set(labels)],
              pkg: pkg.index,
              shallow: pkg.shallow,
            });
            wrap(fnPath, fns.length - 1, serverForm);
          },
        });

        if (fns.length === 0 && marked === 0) return;
        const body = programPath.node.body;
        if (fns.length > 0) {
          let at = 0;
          while (at < body.length && t.isImportDeclaration(body[at])) at++;
          // `var` (not `const`): a hoisted function called during a circular import must not hit the TDZ.
          body.splice(at, 0, t.variableDeclaration("var", [t.variableDeclarator(t.identifier(REGISTRY), t.valueToNode(fns))]));
        }
        if (options.runtimeImport) {
          const load =
            programPath.node.sourceType === "script"
              ? t.expressionStatement(t.callExpression(t.identifier("require"), [t.stringLiteral(options.runtimeImport)]))
              : t.importDeclaration([], t.stringLiteral(options.runtimeImport));
          body.unshift(load);
        }
      },
    },
  };

  function mapa(name: string) {
    return t.memberExpression(t.memberExpression(t.identifier("globalThis"), t.identifier("__mapa")), t.identifier(name));
  }

  function generated<T extends BabelTypes.Node>(node: T): T {
    (node as Generated<T>)[SKIP] = true;
    return node;
  }

  // ---- browser: await points ----

  /** Marks the awaits of every async function (also anonymous ones) of the file. Returns how many. */
  function markAwaits(programPath: NodePath<BabelTypes.Program>): number {
    let count = 0;
    programPath.traverse({
      Function(fnPath) {
        if (!fnPath.node.async || fnPath.node.generator) return;
        let found = false;
        fnPath.traverse({
          Function(inner) {
            inner.skip(); // awaits of nested functions belong to them
          },
          AwaitExpression(awaitPath) {
            const node = awaitPath.node as Generated<BabelTypes.AwaitExpression>;
            if (node[SKIP]) return;
            found = true;
            count++;
            const awaited = generated(t.awaitExpression(t.callExpression(mapa("bf"), [node.argument])));
            // (__mw = 1, af(__mf, await bf(x))): reaching an await means the function ends in a continuation.
            awaitPath.replaceWith(t.sequenceExpression([suspended(), t.callExpression(mapa("af"), [t.identifier(FRAME), awaited])]));
          },
          ForOfStatement(loopPath) {
            if (!loopPath.node.await) return;
            found = true;
            count++;
            // `for await` resumes without an AwaitExpression: restore the frame at each iteration and after the loop.
            const restore = () => t.expressionStatement(t.sequenceExpression([suspended(), t.callExpression(mapa("rs"), [t.identifier(FRAME)])]));
            const loopBody = loopPath.node.body;
            loopPath.node.body = t.blockStatement([restore(), ...(t.isBlockStatement(loopBody) ? loopBody.body : [loopBody])]);
            if (loopPath.parentPath.isBlockStatement() || loopPath.parentPath.isProgram()) loopPath.insertAfter(restore());
          },
        });
        if (!found) return;
        // const __mf = cur(); let __mw = 0; try { body } finally { rs(__mw ? null : __mf) }
        // A continuation resumed after an await runs from the microtask queue: when it ends, the
        // restored frame must not leak into whatever runs next (React re-renders, other clicks).
        // If the function finished without suspending, its caller is still running: keep its frame.
        const body = ensureBlockBody(fnPath);
        const end = t.expressionStatement(
          t.callExpression(mapa("rs"), [t.conditionalExpression(t.identifier(SUSPENDED), t.nullLiteral(), t.identifier(FRAME))]),
        );
        body.body = [
          t.variableDeclaration("const", [t.variableDeclarator(t.identifier(FRAME), t.callExpression(mapa("cur"), []))]),
          t.variableDeclaration("let", [t.variableDeclarator(t.identifier(SUSPENDED), t.numericLiteral(0))]),
          t.tryStatement(t.blockStatement(body.body), null, t.blockStatement([end])),
        ];
      },
    });
    return count;
  }

  function suspended() {
    return t.assignmentExpression("=", t.identifier(SUSPENDED), t.numericLiteral(1));
  }

  function ensureBlockBody(fnPath: FunctionPath): BabelTypes.BlockStatement {
    const node = fnPath.node;
    if (!t.isBlockStatement(node.body)) node.body = t.blockStatement([t.returnStatement(node.body)]);
    return node.body;
  }

  // ---- which functions are recorded, and their names ----

  function describe(fnPath: FunctionPath, fileBase: string, allowsJsx: boolean): Description | undefined {
    const node = fnPath.node;
    const parent = fnPath.parentPath;
    const fn = (name: string, klass = fileBase, labels: string[] = []): Description => {
      if (allowsJsx && /^[A-Z]/.test(name) && klass === fileBase && !labels.length) labels = ["mapa.react-component"];
      return { name, klass, isStatic: true, labels };
    };

    if (t.isFunctionDeclaration(node)) return fn(node.id ? node.id.name : fileBase);

    if (fnPath.isClassMethod() || fnPath.isClassPrivateMethod()) {
      const klass = className(fnPath.parentPath.parentPath);
      const name = keyName(fnPath.node.key);
      if (!klass || !name) return;
      return { name, klass, isStatic: fnPath.node.static, labels: [] };
    }
    if (fnPath.isObjectMethod()) {
      const name = keyName(fnPath.node.key);
      return name ? { name, klass: fileBase, isStatic: false, labels: [] } : undefined;
    }

    // Arrow functions and function expressions: named by where they are put.
    if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id)) return fn(parent.node.id.name);
    if (parent?.isAssignmentExpression() && parent.node.right === node) {
      const left = parent.node.left;
      if (t.isIdentifier(left)) return fn(left.name);
      if (t.isMemberExpression(left)) {
        const name = keyName(left.property as BabelTypes.Node);
        if (name && !left.computed) return fn(name);
      }
    }
    if (parent?.isExportDefaultDeclaration()) return fn(fileBase);
    if (parent?.isObjectProperty() && parent.node.value === node) {
      const name = keyName(parent.node.key);
      return name ? { name, klass: fileBase, isStatic: true, labels: [] } : undefined;
    }
    if ((parent?.isClassProperty() || parent?.isClassPrivateProperty()) && parent.node.value === node) {
      const klass = className(parent.parentPath?.parentPath);
      const name = keyName(parent.node.key);
      if (!klass || !name) return;
      return { name, klass, isStatic: parent.node.static === true, labels: [] };
    }
    const owner = enclosingName(fnPath) ?? fileBase;
    const line = node.loc!.start.line;
    // Inline event handler: <button onClick={() => ...}> (the target audience writes most handlers inline).
    if (parent?.isJSXExpressionContainer() && parent.parentPath.isJSXAttribute()) {
      const attr = parent.parentPath.node.name;
      if (t.isJSXIdentifier(attr) && /^on[A-Z]/.test(attr.name)) {
        return { name: `${owner}.${attr.name}@${line}`, klass: fileBase, isStatic: true, labels: ["mapa.event-handler"] };
      }
    }
    // Callback given to a React hook: useEffect(() => ...), useCallback(...), React.useMemo(...)
    if (parent?.isCallExpression() && parent.node.arguments[0] === node) {
      const callee = parent.node.callee;
      const hook = t.isIdentifier(callee) ? callee.name : t.isMemberExpression(callee) ? keyName(callee.property as BabelTypes.Node) : undefined;
      if (hook && /^use[A-Z]/.test(hook)) {
        const declarator = parent.parentPath;
        const name = declarator?.isVariableDeclarator() && t.isIdentifier(declarator.node.id) ? declarator.node.id.name : `${owner}.${hook}@${line}`;
        return { name, klass: fileBase, isStatic: true, labels: ["mapa.react-hook"] };
      }
    }
    // Named function expression passed somewhere: foo(function salvar() {...})
    if (t.isFunctionExpression(node) && node.id) return fn(node.id.name);
    return undefined; // other anonymous callbacks (map, then...) are not recorded, as in AppMap
  }

  /** `// @label x` or `// @labels a b` right above the function, as in appmap-node's CommentLabelExtractor. */
  function commentLabels(fnPath: FunctionPath): string[] {
    const nodes: BabelTypes.Node[] = [fnPath.node];
    const statement = fnPath.getStatementParent();
    if (statement && statement.node !== fnPath.node) nodes.push(statement.node);
    if (fnPath.parentPath?.isObjectProperty() || fnPath.parentPath?.isClassProperty()) nodes.push(fnPath.parentPath.node);
    const labels: string[] = [];
    for (const node of nodes) {
      for (const comment of node.leadingComments ?? []) {
        for (const match of comment.value.matchAll(/@labels?\s+([\w.:\- \t]+)/g)) labels.push(...match[1]!.trim().split(/\s+/));
      }
    }
    return labels;
  }

  function className(classPath: NodePath | null | undefined): string | undefined {
    if (!classPath) return;
    const node = classPath.node;
    if ((t.isClassDeclaration(node) || t.isClassExpression(node)) && node.id) return node.id.name;
    const parent = classPath.parentPath;
    if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id)) return parent.node.id.name;
    return;
  }

  function keyName(key: BabelTypes.Node): string | undefined {
    if (t.isIdentifier(key)) return key.name;
    if (t.isStringLiteral(key)) return key.value;
    if (t.isPrivateName(key)) return `#${key.id.name}`;
    return;
  }

  function enclosingName(fnPath: FunctionPath): string | undefined {
    let outer = fnPath.parentPath?.getFunctionParent();
    // The enclosing function may already be wrapped: skip our inner arrow, `__mapa.r(this, () => {...})`.
    while (outer && (outer.node as Generated<BabelTypes.Function>)[SKIP] && outer.parentPath?.isCallExpression()) {
      outer = outer.parentPath.getFunctionParent();
    }
    if (!outer) return;
    const node = outer.node;
    if ((t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) && node.id) return node.id.name;
    const parent = outer.parentPath;
    if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id)) return parent.node.id.name;
    if (parent?.isExportDefaultDeclaration()) return;
    return;
  }

  function paramName(param: BabelTypes.Node): string | null {
    if (t.isTSParameterProperty(param)) return paramName(param.parameter);
    if (t.isIdentifier(param)) return param.name;
    if (t.isAssignmentPattern(param)) return paramName(param.left);
    if (t.isRestElement(param)) return paramName(param.argument);
    if (t.isObjectPattern(param)) {
      const keys = param.properties.map((p) => (t.isObjectProperty(p) ? keyName(p.key) : t.isRestElement(p) ? `...${paramName(p.argument) ?? ""}` : undefined));
      return `{${keys.filter(Boolean).join(", ")}}`;
    }
    if (t.isArrayPattern(param)) return `[${param.elements.map((e) => (e ? paramName(e) ?? "" : "")).join(", ")}]`;
    return null;
  }

  // ---- wrapping ----

  function wrap(fnPath: FunctionPath, index: number, serverForm: boolean) {
    const node = fnPath.node as Generated<BabelTypes.Function>;
    const meta = t.memberExpression(t.identifier(REGISTRY), t.numericLiteral(index), true);
    const record = (thisArg: BabelTypes.Expression, inner: BabelTypes.Expression, args: BabelTypes.Expression) =>
      t.callExpression(mapa("r"), [thisArg, inner, args, meta]);

    if (fnPath.isArrowFunctionExpression()) {
      // (a) => expr   →   (...$mapaArgs) => __mapa.r(undefined, (a) => expr, $mapaArgs, meta)
      const inner = generated(t.cloneNode(fnPath.node, false));
      const outer = generated(t.arrowFunctionExpression([t.restElement(t.identifier(ARGS))], record(t.identifier("undefined"), inner, t.identifier(ARGS)), node.async));
      outer.loc = node.loc;
      fnPath.replaceWith(outer);
      return;
    }

    const body = ensureBlockBody(fnPath);
    const directives = body.directives; // "use server" etc. must stay first in the outer function

    if (serverForm) {
      // Server Actions and "use cache" functions may not use `this` nor `arguments` (Next.js
      // refuses to compile), so the original parameters move to the inner function.
      // (constructors, the only place with TS parameter properties, are never wrapped)
      const inner = generated(t.arrowFunctionExpression(node.params as BabelTypes.FunctionParameter[], t.blockStatement(body.body), node.async));
      node.params = [t.restElement(t.identifier(ARGS))];
      node.body = t.blockStatement([t.returnStatement(record(t.identifier("undefined"), inner, t.identifier(ARGS)))], directives);
    } else {
      // Parameters stay on the outer function, so default values are evaluated only once.
      const inner = generated(t.arrowFunctionExpression([], t.blockStatement(body.body), node.async));
      node.body = t.blockStatement([t.returnStatement(record(t.thisExpression(), inner, t.identifier("arguments")))], directives);
    }
    node[SKIP] = true;
  }
}


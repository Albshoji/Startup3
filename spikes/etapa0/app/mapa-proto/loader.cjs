// SPIKE (Etapa 0) — webpack/Turbopack loader applying the Mapa Babel plugin.
"use strict";
const path = require("node:path");
const fs = require("node:fs");

const LOG = process.env.MAPA_LOADER_LOG; // file to append "layer path ms" lines to

module.exports = function mapaLoader(source, inputMap) {
  const callback = this.async();
  const options = this.getOptions ? this.getOptions() : {};
  const filePath = this.resourcePath;
  const layer = options.layer || "unknown";
  const root = this.rootContext || process.cwd();

  const awaitsOnly = !!options.awaitsOnly;
  if ((!awaitsOnly && filePath.includes("node_modules")) || filePath.includes(`${path.sep}mapa-proto${path.sep}`)) {
    return callback(null, source, inputMap);
  }

  const started = process.hrtime.bigint();
  const ext = path.extname(filePath);
  const isTS = ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts";
  const jsx = ext !== ".ts" && ext !== ".mts" && ext !== ".cts";
  const runtimeFile = path.join(__dirname, layer === "browser" ? "runtime-browser.js" : "runtime-server.js");
  let runtimeImport = path.relative(path.dirname(filePath), runtimeFile).split(path.sep).join("/");
  if (!runtimeImport.startsWith(".")) runtimeImport = "./" + runtimeImport;

  const babel = require("@babel/core");
  babel
    .transformAsync(source, {
      filename: filePath,
      babelrc: false,
      configFile: false,
      sourceMaps: true,
      inputSourceMap: inputMap || undefined,
      parserOpts: {
        plugins: [...(isTS ? [["typescript", {}]] : []), ...(jsx ? ["jsx"] : [])],
      },
      generatorOpts: { retainLines: false },
      plugins: [[require("./babel-plugin.cjs"), { layer, root, runtimeImport, awaitsOnly }]],
    })
    .then((result) => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      if (LOG) fs.appendFileSync(LOG, `${layer}${awaitsOnly ? "+awaits" : ""}\t${path.relative(root, filePath)}\t${ms.toFixed(1)}\n`);
      callback(null, result.code, result.map || undefined);
    })
    .catch((err) => {
      console.warn(`[mapa] could not instrument ${filePath}: ${err.message}`);
      if (LOG) fs.appendFileSync(LOG, `${layer}\t${path.relative(root, filePath)}\tERROR ${err.message.split("\n")[0]}\n`);
      callback(null, source, inputMap);
    });
};

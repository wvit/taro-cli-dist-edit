"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs-extra");
const path = require("path");
const child_process_1 = require("child_process");
const perf_hooks_1 = require("perf_hooks");
const chokidar = require("chokidar");
const chalk_1 = require("chalk");
const _ = require("lodash");
const klaw = require("klaw");
const Util = require("./util");
const config_1 = require("./config");
const StyleProcess = require("./rn/styleProcess");
const transformJS_1 = require("./rn/transformJS");
const constants_1 = require("./util/constants");
const convert_to_jdreact_1 = require("./jdreact/convert_to_jdreact");
// import { Error } from 'tslint/lib/error'
let isBuildingStyles = {};
let styleDenpendencyTree = {};
const depTree = {};
const TEMP_DIR_NAME = 'rn_temp';
const BUNDLE_DIR_NAME = 'bundle';
class Compiler {
    // pxTransformConfig
    // pathAlias
    constructor(appPath) {
        this.appPath = appPath;
        this.projectConfig = require(path.join(appPath, constants_1.PROJECT_CONFIG))(_.merge);
        const sourceDirName = this.projectConfig.sourceRoot || config_1.default.SOURCE_DIR;
        this.sourceDir = path.join(appPath, sourceDirName);
        this.entryFilePath = Util.resolveScriptPath(path.join(this.sourceDir, config_1.default.ENTRY));
        this.entryFileName = path.basename(this.entryFilePath);
        this.entryBaseName = path.basename(this.entryFilePath, path.extname(this.entryFileName));
        this.pluginsConfig = this.projectConfig.plugins || {};
        this.rnConfig = this.projectConfig.rn || {};
        // 直接输出编译后代码到指定目录
        if (this.rnConfig.outPath) {
            this.tempPath = path.resolve(this.appPath, this.rnConfig.outPath);
            if (!fs.existsSync(this.tempPath)) {
                throw new Error(`outPath ${this.tempPath} 不存在`);
            }
            this.hasJDReactOutput = true;
        }
        else {
            this.tempPath = path.join(appPath, TEMP_DIR_NAME);
            this.hasJDReactOutput = false;
        }
    }
    isEntryFile(filePath) {
        return path.basename(filePath) === this.entryFileName;
    }
    compileDepStyles(filePath, styleFiles) {
        if (isBuildingStyles[filePath] || styleFiles.length === 0) {
            return Promise.resolve({});
        }
        isBuildingStyles[filePath] = true;
        return Promise.all(styleFiles.map((p) => __awaiter(this, void 0, void 0, function* () {
            const filePath = path.join(p);
            const fileExt = path.extname(filePath);
            Util.printLog("compile" /* COMPILE */, _.camelCase(fileExt).toUpperCase(), filePath);
            return StyleProcess.loadStyle({ filePath, pluginsConfig: this.pluginsConfig }, this.appPath);
        }))).then(resList => {
            return Promise.all(resList.map(item => {
                return StyleProcess.postCSS(Object.assign({}, item, { projectConfig: this.projectConfig }));
            }));
        }).then(resList => {
            const styleObjectEntire = {};
            resList.forEach(item => {
                const styleObject = StyleProcess.getStyleObject({ css: item.css, filePath: item.filePath });
                // validate styleObject
                StyleProcess.validateStyle({ styleObject, filePath: item.filePath });
                Object.assign(styleObjectEntire, styleObject);
                if (filePath !== this.entryFilePath) { // 非入口文件，合并全局样式
                    Object.assign(styleObjectEntire, _.get(styleDenpendencyTree, [this.entryFilePath, 'styleObjectEntire'], {}));
                }
                styleDenpendencyTree[filePath] = {
                    styleFiles,
                    styleObjectEntire
                };
            });
            return JSON.stringify(styleObjectEntire, null, 2);
        }).then(css => {
            let tempFilePath = filePath.replace(this.sourceDir, this.tempPath);
            const basename = path.basename(tempFilePath, path.extname(tempFilePath));
            tempFilePath = path.join(path.dirname(tempFilePath), `${basename}_styles.js`);
            StyleProcess.writeStyleFile({ css, tempFilePath });
        }).catch((e) => {
            throw new Error(e);
        });
    }
    initProjectFile() {
        // generator app.json
        const appJsonObject = Object.assign({
            name: _.camelCase(require(path.join(this.appPath, 'package.json')).name)
        }, this.rnConfig.appJson);
        const indexJsStr = `
    import {AppRegistry} from 'react-native';
    import App from './${this.entryBaseName}';
    import {name as appName} from './app.json';
  
    AppRegistry.registerComponent(appName, () => App);`;
        fs.writeFileSync(path.join(this.tempPath, 'index.js'), indexJsStr);
        Util.printLog("generate" /* GENERATE */, 'index.js', path.join(this.tempPath, 'index.js'));
        fs.writeFileSync(path.join(this.tempPath, 'app.json'), JSON.stringify(appJsonObject, null, 2));
        Util.printLog("generate" /* GENERATE */, 'app.json', path.join(this.tempPath, 'app.json'));
        return Promise.resolve();
    }
    processFile(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!fs.existsSync(filePath)) {
                return;
            }
            const dirname = path.dirname(filePath);
            const distDirname = dirname.replace(this.sourceDir, this.tempPath);
            let distPath = path.format({ dir: distDirname, base: path.basename(filePath) });
            const code = fs.readFileSync(filePath, 'utf-8');
            if (constants_1.REG_STYLE.test(filePath)) {
                // do something
            }
            else if (constants_1.REG_SCRIPTS.test(filePath)) {
                if (constants_1.REG_TYPESCRIPT.test(filePath)) {
                    distPath = distPath.replace(/\.(tsx|ts)(\?.*)?$/, '.js');
                }
                Util.printLog("compile" /* COMPILE */, _.camelCase(path.extname(filePath)).toUpperCase(), filePath);
                // transformJSCode
                const transformResult = transformJS_1.parseJSCode({
                    code, filePath, isEntryFile: this.isEntryFile(filePath), projectConfig: this.projectConfig
                });
                const jsCode = transformResult.code;
                fs.ensureDirSync(distDirname);
                fs.writeFileSync(distPath, Buffer.from(jsCode));
                Util.printLog("generate" /* GENERATE */, _.camelCase(path.extname(filePath)).toUpperCase(), distPath);
                // compileDepStyles
                const styleFiles = transformResult.styleFiles;
                depTree[filePath] = styleFiles;
                yield this.compileDepStyles(filePath, styleFiles);
            }
            else {
                fs.ensureDirSync(distDirname);
                Util.printLog("copy" /* COPY */, _.camelCase(path.extname(filePath)).toUpperCase(), filePath);
                fs.copySync(filePath, distPath);
                Util.printLog("generate" /* GENERATE */, _.camelCase(path.extname(filePath)).toUpperCase(), distPath);
            }
        });
    }
    /**
     * @description 编译文件，安装依赖
     * @returns {Promise}
     */
    buildTemp() {
        return new Promise((resolve, reject) => {
            klaw(this.sourceDir)
                .on('data', file => {
                if (!file.stats.isDirectory()) {
                    this.processFile(file.path);
                }
            })
                .on('error', (err, item) => {
                console.log(err.message);
                console.log(item.path);
            })
                .on('end', () => {
                if (!this.hasJDReactOutput) {
                    this.initProjectFile();
                    resolve();
                }
                else {
                    resolve();
                }
            });
        });
    }
    buildBundle() {
        fs.ensureDirSync(TEMP_DIR_NAME);
        process.chdir(TEMP_DIR_NAME);
        // 通过 jdreact  构建 bundle
        if (this.rnConfig.bundleType === 'jdreact') {
            console.log();
            console.log(chalk_1.default.green('生成JDReact 目录：'));
            console.log();
            convert_to_jdreact_1.convertToJDReact({
                tempPath: this.tempPath, entryBaseName: this.entryBaseName
            });
            return;
        }
        // 默认打包到 bundle 文件夹
        fs.ensureDirSync(BUNDLE_DIR_NAME);
        child_process_1.execSync(`node ../node_modules/react-native/local-cli/cli.js bundle --entry-file ./${TEMP_DIR_NAME}/index.js --bundle-output ./${BUNDLE_DIR_NAME}/index.bundle --assets-dest ./${BUNDLE_DIR_NAME} --dev false`, { stdio: 'inherit' });
    }
    perfWrap(callback, args) {
        return __awaiter(this, void 0, void 0, function* () {
            isBuildingStyles = {}; // 清空
            // 后期可以优化，不编译全部
            const t0 = perf_hooks_1.performance.now();
            yield callback(args);
            const t1 = perf_hooks_1.performance.now();
            Util.printLog("compile" /* COMPILE */, `编译完成，花费${Math.round(t1 - t0)} ms`);
            console.log();
        });
    }
    watchFiles() {
        const watcher = chokidar.watch(path.join(this.sourceDir), {
            ignored: /(^|[/\\])\../,
            persistent: true,
            ignoreInitial: true
        });
        watcher
            .on('ready', () => {
            console.log();
            console.log(chalk_1.default.gray('初始化完毕，监听文件修改中...'));
            console.log();
        })
            .on('add', filePath => {
            const relativePath = path.relative(this.appPath, filePath);
            Util.printLog("create" /* CREATE */, '添加文件', relativePath);
            this.perfWrap(this.buildTemp.bind(this));
        })
            .on('change', filePath => {
            const relativePath = path.relative(this.appPath, filePath);
            Util.printLog("modify" /* MODIFY */, '文件变动', relativePath);
            if (constants_1.REG_SCRIPTS.test(filePath)) {
                this.perfWrap(this.processFile.bind(this), filePath);
            }
            if (constants_1.REG_STYLE.test(filePath)) {
                _.forIn(depTree, (styleFiles, jsFilePath) => {
                    if (styleFiles.indexOf(filePath) > -1) {
                        this.perfWrap(this.processFile.bind(this), jsFilePath);
                    }
                });
            }
        })
            .on('unlink', filePath => {
            const relativePath = path.relative(this.appPath, filePath);
            Util.printLog("unlink" /* UNLINK */, '删除文件', relativePath);
            this.perfWrap(this.buildTemp.bind(this));
        })
            .on('error', error => console.log(`Watcher error: ${error}`));
    }
}
exports.Compiler = Compiler;
function hasRNDep(appPath) {
    const pkgJson = require(path.join(appPath, 'package.json'));
    return Boolean(pkgJson.dependencies['react-native']);
}
function updatePkgJson(appPath) {
    const version = Util.getPkgVersion();
    const RNDep = `{
    "@tarojs/components-rn": "^${version}",
    "@tarojs/taro-rn": "^${version}",
    "@tarojs/taro-router-rn": "^${version}",
    "@tarojs/taro-redux-rn": "^${version}",
    "react": "16.3.1",
    "react-native": "0.55.4",
    "redux": "^4.0.0",
    "tslib": "^1.8.0"
  }
  `;
    return new Promise((resolve, reject) => {
        const pkgJson = require(path.join(appPath, 'package.json'));
        // 未安装 RN 依赖,则更新 pkgjson,并重新安装依赖
        if (!hasRNDep(appPath)) {
            pkgJson.dependencies = Object.assign({}, pkgJson.dependencies, JSON.parse(RNDep.replace(/(\r\n|\n|\r|\s+)/gm, '')));
            fs.writeFileSync(path.join(appPath, 'package.json'), JSON.stringify(pkgJson, null, 2));
            Util.printLog("generate" /* GENERATE */, 'package.json', path.join(appPath, 'package.json'));
            installDep(appPath).then(() => {
                resolve();
            });
        }
        else {
            resolve();
        }
    });
}
function installDep(path) {
    return new Promise((resolve, reject) => {
        console.log();
        console.log(chalk_1.default.yellow('开始安装依赖~'));
        process.chdir(path);
        let command;
        if (Util.shouldUseYarn()) {
            command = 'yarn';
        }
        else if (Util.shouldUseCnpm()) {
            command = 'cnpm install';
        }
        else {
            command = 'npm install';
        }
        child_process_1.exec(command, (err, stdout, stderr) => {
            if (err)
                reject();
            else {
                console.log(stdout);
                console.log(stderr);
            }
            resolve();
        });
    });
}
function build(appPath, buildConfig) {
    return __awaiter(this, void 0, void 0, function* () {
        const { watch } = buildConfig;
        process.env.TARO_ENV = "rn" /* RN */;
        const compiler = new Compiler(appPath);
        fs.ensureDirSync(compiler.tempPath);
        const t0 = perf_hooks_1.performance.now();
        if (!hasRNDep(appPath)) {
            yield updatePkgJson(appPath);
        }
        try {
            yield compiler.buildTemp();
        }
        catch (e) {
            throw e;
        }
        const t1 = perf_hooks_1.performance.now();
        Util.printLog("compile" /* COMPILE */, `编译完成，花费${Math.round(t1 - t0)} ms`);
        if (watch) {
            compiler.watchFiles();
            if (!compiler.hasJDReactOutput) {
                startServerInNewWindow({ appPath });
            }
        }
        else {
            compiler.buildBundle();
        }
    });
}
exports.build = build;
/**
 * @description run packager server
 * copy from react-native/local-cli/runAndroid/runAndroid.js
 */
function startServerInNewWindow({ port = 8081, appPath }) {
    // set up OS-specific filenames and commands
    const isWindows = /^win/.test(process.platform);
    const scriptFile = isWindows
        ? 'launchPackager.bat'
        : 'launchPackager.command';
    const packagerEnvFilename = isWindows ? '.packager.bat' : '.packager.env';
    const portExportContent = isWindows
        ? `set RCT_METRO_PORT=${port}`
        : `export RCT_METRO_PORT=${port}`;
    // set up the launchpackager.(command|bat) file
    const scriptsDir = path.resolve(appPath, './node_modules', 'react-native', 'scripts');
    const launchPackagerScript = path.resolve(scriptsDir, scriptFile);
    const procConfig = { cwd: scriptsDir };
    const terminal = process.env.REACT_TERMINAL;
    // set up the .packager.(env|bat) file to ensure the packager starts on the right port
    const packagerEnvFile = path.join(appPath, 'node_modules', 'react-native', 'scripts', packagerEnvFilename);
    // ensure we overwrite file by passing the 'w' flag
    fs.writeFileSync(packagerEnvFile, portExportContent, {
        encoding: 'utf8',
        flag: 'w'
    });
    if (process.platform === 'darwin') {
        if (terminal) {
            return child_process_1.spawnSync('open', ['-a', terminal, launchPackagerScript], procConfig);
        }
        return child_process_1.spawnSync('open', [launchPackagerScript], procConfig);
    }
    else if (process.platform === 'linux') {
        if (terminal) {
            return child_process_1.spawn(terminal, ['-e', 'sh ' + launchPackagerScript], procConfig);
        }
        return child_process_1.spawn('sh', [launchPackagerScript], procConfig);
    }
    else if (/^win/.test(process.platform)) {
        procConfig.stdio = 'ignore';
        return child_process_1.spawn('cmd.exe', ['/C', launchPackagerScript], procConfig);
    }
    else {
        console.log(chalk_1.default.red(`Cannot start the packager. Unknown platform ${process.platform}`));
    }
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs-extra");
const path = require("path");
const _ = require("lodash");
const wxTransformer = require("@tarojs/transformer-wx");
const constants_1 = require("../util/constants");
const util_1 = require("../util");
const resolve_npm_files_1 = require("../util/resolve_npm_files");
const config_1 = require("../config");
const npmExact_1 = require("../util/npmExact");
const astProcess_1 = require("./astProcess");
const isCopyingFiles = new Map();
const dependencyTree = new Map();
const hasBeenBuiltComponents = new Set();
const componentExportsMap = new Map();
const depComponents = new Map();
let BuildData;
exports.shouldTransformAgain = function () {
    const babelConfig = util_1.getBabelConfig(BuildData.projectConfig.plugins.babel);
    const pluginsStr = JSON.stringify(babelConfig.plugins);
    if (/transform-runtime/.test(pluginsStr)) {
        return true;
    }
    return false;
};
function setAppConfig(appConfig) {
    BuildData.appConfig = appConfig;
}
exports.setAppConfig = setAppConfig;
function setIsProduction(isProduction) {
    BuildData.isProduction = isProduction;
}
exports.setIsProduction = setIsProduction;
function setBuildData(appPath, adapter, TARO_ENV) {
    const configDir = path.join(appPath, constants_1.PROJECT_CONFIG);
    const projectConfig = require(configDir)(_.merge);
    const sourceDirName = projectConfig.sourceRoot || config_1.default.SOURCE_DIR;
    const outputDirName = projectConfig.outputRoot || config_1.default.OUTPUT_DIR;
    const sourceDir = path.join(appPath, sourceDirName);
    const outputDir = path.join(appPath, outputDirName);
    const entryFilePath = util_1.resolveScriptPath(path.join(sourceDir, config_1.default.ENTRY));
    const entryFileName = path.basename(entryFilePath);
    const pathAlias = projectConfig.alias || {};
    const weappConf = projectConfig.weapp || {};
    const npmConfig = Object.assign({
        name: config_1.default.NPM_DIR,
        dir: null
    }, weappConf.npm);
    const useCompileConf = Object.assign({}, weappConf.compile);
    const compileInclude = useCompileConf.include || [];
    BuildData = {
        appPath,
        configDir,
        sourceDirName,
        outputDirName,
        sourceDir,
        outputDir,
        originalOutputDir: outputDir,
        entryFilePath,
        entryFileName,
        projectConfig,
        npmConfig,
        alias: pathAlias,
        isProduction: false,
        appConfig: {},
        pageConfigs: new Map(),
        compileInclude,
        buildAdapter: adapter,
        outputFilesTypes: constants_1.MINI_APP_FILES[adapter],
        constantsReplaceList: Object.assign({},
            util_1.generateEnvList(projectConfig.env || {}),
            util_1.generateConstantsList(projectConfig.defineConstants || {}),
            {
                'process.env.TARO_ENV': TARO_ENV || adapter //wv-edit 使用weapp的打包方式,但是环境变量为qq
            }),
        nodeModulesPath: util_1.recursiveFindNodeModules(path.join(appPath, constants_1.NODE_MODULES)),
        npmOutputDir: npmExact_1.getNpmOutputDir(outputDir, configDir, npmConfig),
        jsxAttributeNameReplace: weappConf.jsxAttributeNameReplace || {}
    };
    // 可以自定义输出文件类型
    if (weappConf.customFilesTypes && !util_1.isEmptyObject(weappConf.customFilesTypes)) {
        BuildData.outputFilesTypes = Object.assign({}, BuildData.outputFilesTypes, weappConf.customFilesTypes[adapter] || {});
    }
    if (adapter === "quickapp" /* QUICKAPP */) {
        BuildData.originalOutputDir = BuildData.outputDir;
        BuildData.outputDirName = `${BuildData.outputDirName}/src`;
        BuildData.outputDir = path.join(BuildData.appPath, BuildData.outputDirName);
        BuildData.npmOutputDir = npmExact_1.getNpmOutputDir(BuildData.outputDir, BuildData.configDir, BuildData.npmConfig);
    }
    return BuildData;
}
exports.setBuildData = setBuildData;
function getBuildData() {
    return BuildData;
}
exports.getBuildData = getBuildData;
function getDependencyTree() {
    return dependencyTree;
}
exports.getDependencyTree = getDependencyTree;
function setHasBeenBuiltComponents(componentPath) {
    hasBeenBuiltComponents.add(componentPath);
}
exports.setHasBeenBuiltComponents = setHasBeenBuiltComponents;
function getHasBeenBuiltComponents() {
    return hasBeenBuiltComponents;
}
exports.getHasBeenBuiltComponents = getHasBeenBuiltComponents;
function isComponentHasBeenBuilt(componentPath) {
    return hasBeenBuiltComponents.has(componentPath);
}
exports.isComponentHasBeenBuilt = isComponentHasBeenBuilt;
function deleteHasBeenBuiltComponent(filePath) {
    if (hasBeenBuiltComponents.has(filePath)) {
        hasBeenBuiltComponents.delete(filePath);
    }
}
exports.deleteHasBeenBuiltComponent = deleteHasBeenBuiltComponent;
function setComponentExportsMap(key, value) {
    componentExportsMap.set(key, value);
}
exports.setComponentExportsMap = setComponentExportsMap;
function getComponentExportsMapItem(key) {
    return componentExportsMap.get(key);
}
exports.getComponentExportsMapItem = getComponentExportsMapItem;
function getComponentExportsMap() {
    return componentExportsMap;
}
exports.getComponentExportsMap = getComponentExportsMap;
function getDepComponents() {
    return depComponents;
}
exports.getDepComponents = getDepComponents;
function buildUsingComponents(filePath, components, isComponent) {
    const usingComponents = Object.create(null);
    const pathAlias = BuildData.projectConfig.alias || {};
    for (const component of components) {
        let componentPath = component.path;
        if (util_1.isAliasPath(componentPath, pathAlias)) {
            componentPath = util_1.replaceAliasPath(filePath, componentPath, pathAlias);
        }
        componentPath = util_1.resolveScriptPath(path.resolve(filePath, '..', componentPath));
        if (fs.existsSync(componentPath)) {
            componentPath = util_1.promoteRelativePath(path.relative(filePath, componentPath));
        }
        else {
            componentPath = component.path;
        }
        if (component.name) {
            usingComponents[component.name] = componentPath.replace(path.extname(componentPath), '');
        }
    }
    return Object.assign({}, isComponent ? { component: true } : { usingComponents: {} }, components.length ? {
        usingComponents
    } : {});
}
exports.buildUsingComponents = buildUsingComponents;
function getRealComponentsPathList(filePath, components) {
    const { appPath, isProduction, buildAdapter, projectConfig, npmConfig } = BuildData;
    const pathAlias = projectConfig.alias || {};
    return components.map(component => {
        let componentPath = component.path;
        if (util_1.isAliasPath(componentPath, pathAlias)) {
            componentPath = util_1.replaceAliasPath(filePath, componentPath, pathAlias);
        }
        if (util_1.isNpmPkg(componentPath)) {
            try {
                componentPath = resolve_npm_files_1.resolveNpmPkgMainPath(componentPath, isProduction, npmConfig, buildAdapter, appPath);
            }
            catch (err) {
                console.log(err);
            }
        }
        else {
            componentPath = path.resolve(path.dirname(filePath), componentPath);
            componentPath = util_1.resolveScriptPath(componentPath);
        }
        if (componentPath && isFileToBePage(componentPath)) {
            util_1.printLog("error" /* ERROR */, '组件引用', `文件${component.path}已经在 app.js 中被指定为页面，不能再作为组件来引用！`);
        }
        return {
            path: componentPath,
            name: component.name,
            type: component.type
        };
    });
}
exports.getRealComponentsPathList = getRealComponentsPathList;
function isFileToBePage(filePath) {
    let isPage = false;
    const { appConfig, sourceDir } = BuildData;
    const extname = path.extname(filePath);
    const pages = appConfig.pages || [];
    const filePathWithoutExt = filePath.replace(extname, '');
    pages.forEach(page => {
        if (filePathWithoutExt === path.join(sourceDir, page)) {
            isPage = true;
        }
    });
    return isPage && constants_1.REG_SCRIPTS.test(extname);
}
exports.isFileToBePage = isFileToBePage;
function getDepStyleList(outputFilePath, buildDepComponentsResult) {
    const { sourceDir, outputDir } = BuildData;
    let depWXSSList = [];
    if (buildDepComponentsResult.length) {
        depWXSSList = buildDepComponentsResult.map(item => {
            let wxss = item.wxss;
            wxss = wxss.replace(sourceDir, outputDir);
            wxss = util_1.promoteRelativePath(path.relative(outputFilePath, wxss));
            return wxss;
        });
    }
    return depWXSSList;
}
exports.getDepStyleList = getDepStyleList;
function initCopyFiles() {
    isCopyingFiles.clear();
}
exports.initCopyFiles = initCopyFiles;
function copyFilesFromSrcToOutput(files, cb) {
    const { nodeModulesPath, npmOutputDir, sourceDir, outputDir, appPath } = BuildData;
    files.forEach(file => {
        let outputFilePath;
        if (constants_1.NODE_MODULES_REG.test(file)) {
            outputFilePath = file.replace(nodeModulesPath, npmOutputDir);
        }
        else {
            outputFilePath = file.replace(sourceDir, outputDir);
        }
        if (isCopyingFiles.get(outputFilePath)) {
            return;
        }
        isCopyingFiles.set(outputFilePath, true);
        let modifySrc = file.replace(appPath + path.sep, '');
        modifySrc = modifySrc.split(path.sep).join('/');
        let modifyOutput = outputFilePath.replace(appPath + path.sep, '');
        modifyOutput = modifyOutput.split(path.sep).join('/');
        util_1.printLog("copy" /* COPY */, '文件', modifyOutput);
        if (!fs.existsSync(file)) {
            util_1.printLog("error" /* ERROR */, '文件', `${modifySrc} 不存在`);
        }
        else {
            fs.ensureDir(path.dirname(outputFilePath));
            if (file === outputFilePath) {
                return;
            }
            if (cb) {
                cb(file, outputFilePath);
            }
            else {
                fs.copySync(file, outputFilePath);
            }
        }
    });
}
exports.copyFilesFromSrcToOutput = copyFilesFromSrcToOutput;
function getTaroJsQuickAppComponentsPath() {
    const taroJsQuickAppComponentsPkg = util_1.getInstalledNpmPkgPath(constants_1.taroJsQuickAppComponents, BuildData.nodeModulesPath);
    if (!taroJsQuickAppComponentsPkg) {
        util_1.printLog("error" /* ERROR */, '包安装', `缺少包 ${constants_1.taroJsQuickAppComponents}，请安装！`);
        process.exit(0);
    }
    return path.join(path.dirname(taroJsQuickAppComponentsPkg), 'src/components');
}
exports.getTaroJsQuickAppComponentsPath = getTaroJsQuickAppComponentsPath;
const SCRIPT_CONTENT_REG = /<script\b[^>]*>([\s\S]*?)<\/script>/gm;
function getImportTaroSelfComponents(filePath, taroSelfComponents) {
    const importTaroSelfComponents = new Set();
    const taroJsQuickAppComponentsPath = getTaroJsQuickAppComponentsPath();
    taroSelfComponents.forEach(c => {
        const cPath = path.join(taroJsQuickAppComponentsPath, c);
        const cMainPath = path.join(cPath, 'index');
        const cFiles = fs.readdirSync(cPath).map(item => path.join(cPath, item));
        copyFilesFromSrcToOutput(cFiles, (sourceFilePath, outputFilePath) => {
            if (fs.existsSync(sourceFilePath)) {
                const fileContent = fs.readFileSync(sourceFilePath).toString();
                const match = SCRIPT_CONTENT_REG.exec(fileContent);
                if (match) {
                    const scriptContent = match[1];
                    const transformResult = wxTransformer({
                        code: scriptContent,
                        sourcePath: sourceFilePath,
                        sourceDir: getBuildData().sourceDir,
                        outputPath: outputFilePath,
                        isNormal: true,
                        isTyped: false,
                        adapter: "quickapp" /* QUICKAPP */
                    });
                    const res = astProcess_1.parseAst(constants_1.PARSE_AST_TYPE.NORMAL, transformResult.ast, [], sourceFilePath, outputFilePath);
                    const newFileContent = fileContent.replace(SCRIPT_CONTENT_REG, `<script>${res.code}</script>`);
                    fs.ensureDirSync(path.dirname(outputFilePath));
                    fs.writeFileSync(outputFilePath, newFileContent);
                }
            }
        });
        const cRelativePath = util_1.promoteRelativePath(path.relative(filePath, cMainPath.replace(BuildData.nodeModulesPath, BuildData.npmOutputDir)));
        importTaroSelfComponents.add({
            path: cRelativePath,
            name: c
        });
    });
    return importTaroSelfComponents;
}
exports.getImportTaroSelfComponents = getImportTaroSelfComponents;

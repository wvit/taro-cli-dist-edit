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
const chalk_1 = require("chalk");
const prettier = require("prettier");
const babel_traverse_1 = require("babel-traverse");
const t = require("babel-types");
const taroize = require("@tarojs/taroize");
const wxTransformer = require("@tarojs/transformer-wx");
const postcss = require("postcss");
const unitTransform = require("postcss-taro-unit-transform");
const util_1 = require("../util");
const constants_1 = require("../util/constants");
const astConvert_1 = require("../util/astConvert");
const creator_1 = require("../create/creator");
const babylon_1 = require("../config/babylon");
const helper_1 = require("./helper");
const template = require('babel-template');
const prettierJSConfig = {
    semi: false,
    singleQuote: true,
    parser: 'babel'
};
const OUTPUT_STYLE_EXTNAME = '.scss';
const WX_GLOBAL_FN = new Set(['getApp', 'getCurrentPages', 'requirePlugin']);
class Convertor {
    constructor(root) {
        this.root = root;
        this.convertRoot = path.join(this.root, 'taroConvert');
        this.convertDir = path.join(this.convertRoot, 'src');
        this.importsDir = path.join(this.convertDir, 'imports');
        this.fileTypes = constants_1.MINI_APP_FILES["weapp" /* WEAPP */];
        this.pages = new Set();
        this.components = new Set();
        this.hadBeenCopyedFiles = new Set();
        this.hadBeenBuiltComponents = new Set();
        this.hadBeenBuiltImports = new Set();
        this.init();
    }
    init() {
        console.log(chalk_1.default.green('开始代码转换...'));
        this.initConvert();
        this.getApp();
        this.getPages();
        this.getSubPackages();
    }
    initConvert() {
        if (fs.existsSync(this.convertRoot)) {
            util_1.emptyDirectory(this.convertRoot, { excludes: ['node_modules'] });
        }
        else {
            fs.ensureDirSync(this.convertRoot);
        }
    }
    parseAst({ ast, sourceFilePath, outputFilePath, importStylePath, depComponents, imports = [], isApp = false }) {
        const scriptFiles = new Set();
        const self = this;
        let componentClassName;
        let needInsertImportTaro = false;
        babel_traverse_1.default(ast, {
            Program: {
                enter(astPath) {
                    astPath.traverse({
                        ClassDeclaration(astPath) {
                            const node = astPath.node;
                            let isTaroComponent = false;
                            if (node.superClass) {
                                astPath.traverse({
                                    ClassMethod(astPath) {
                                        if (astPath.get('key').isIdentifier({ name: 'render' })) {
                                            astPath.traverse({
                                                JSXElement() {
                                                    isTaroComponent = true;
                                                }
                                            });
                                        }
                                    }
                                });
                                if (isTaroComponent) {
                                    componentClassName = node.id.name;
                                }
                            }
                        },
                        ClassExpression(astPath) {
                            const node = astPath.node;
                            if (node.superClass) {
                                let isTaroComponent = false;
                                astPath.traverse({
                                    ClassMethod(astPath) {
                                        if (astPath.get('key').isIdentifier({ name: 'render' })) {
                                            astPath.traverse({
                                                JSXElement() {
                                                    isTaroComponent = true;
                                                }
                                            });
                                        }
                                    }
                                });
                                if (isTaroComponent) {
                                    if (node.id === null) {
                                        const parentNode = astPath.parentPath.node;
                                        if (t.isVariableDeclarator(astPath.parentPath)) {
                                            componentClassName = parentNode.id.name;
                                        }
                                    }
                                    else {
                                        componentClassName = node.id.name;
                                    }
                                }
                            }
                        },
                        ExportDefaultDeclaration(astPath) {
                            const node = astPath.node;
                            const declaration = node.declaration;
                            if (declaration &&
                                (declaration.type === 'ClassDeclaration' || declaration.type === 'ClassExpression')) {
                                const superClass = declaration.superClass;
                                if (superClass) {
                                    let isTaroComponent = false;
                                    astPath.traverse({
                                        ClassMethod(astPath) {
                                            if (astPath.get('key').isIdentifier({ name: 'render' })) {
                                                astPath.traverse({
                                                    JSXElement() {
                                                        isTaroComponent = true;
                                                    }
                                                });
                                            }
                                        }
                                    });
                                    if (isTaroComponent) {
                                        componentClassName = declaration.id.name;
                                    }
                                }
                            }
                        },
                        ImportDeclaration(astPath) {
                            const node = astPath.node;
                            const source = node.source;
                            const value = source.value;
                            helper_1.analyzeImportUrl(sourceFilePath, scriptFiles, source, value);
                        },
                        CallExpression(astPath) {
                            const node = astPath.node;
                            const calleePath = astPath.get('callee');
                            const callee = calleePath.node;
                            if (callee.type === 'Identifier') {
                                if (callee.name === 'require') {
                                    const args = node.arguments;
                                    const value = args[0].value;
                                    helper_1.analyzeImportUrl(sourceFilePath, scriptFiles, args[0], value);
                                }
                                else if (WX_GLOBAL_FN.has(callee.name)) {
                                    calleePath.replaceWith(t.memberExpression(t.identifier('Taro'), callee));
                                    needInsertImportTaro = true;
                                }
                            }
                            else if (callee.type === 'MemberExpression') {
                                const object = callee.object;
                                if (object.name === 'wx') {
                                    calleePath.get('object').replaceWith(t.identifier('Taro'));
                                    needInsertImportTaro = true;
                                }
                            }
                        }
                    });
                },
                exit(astPath) {
                    const bodyNode = astPath.get('body');
                    const lastImport = bodyNode.filter(p => p.isImportDeclaration()).pop();
                    const hasTaroImport = bodyNode.some(p => p.isImportDeclaration() && p.node.source.value === '@tarojs/taro');
                    if (needInsertImportTaro && !hasTaroImport) {
                        astPath.node.body.unshift(t.importDeclaration([t.importDefaultSpecifier(t.identifier('Taro'))], t.stringLiteral('@tarojs/taro')));
                    }
                    astPath.traverse({
                        StringLiteral(astPath) {
                            const value = astPath.node.value;
                            const extname = path.extname(value);
                            if (extname && constants_1.REG_IMAGE.test(extname) && !constants_1.REG_URL.test(value)) {
                                let imageRelativePath;
                                let sourceImagePath;
                                let outputImagePath;
                                if (path.isAbsolute(value)) {
                                    sourceImagePath = path.join(self.root, value);
                                }
                                else {
                                    sourceImagePath = path.resolve(sourceFilePath, '..', value);
                                }
                                imageRelativePath = util_1.promoteRelativePath(path.relative(sourceFilePath, sourceImagePath));
                                outputImagePath = self.getDistFilePath(sourceImagePath);
                                if (fs.existsSync(sourceImagePath)) {
                                    self.copyFileToTaro(sourceImagePath, outputImagePath);
                                    util_1.printLog("copy" /* COPY */, '图片', self.generateShowPath(outputImagePath));
                                }
                                else {
                                    util_1.printLog("error" /* ERROR */, '图片不存在', self.generateShowPath(sourceImagePath));
                                }
                                if (astPath.parentPath.isVariableDeclarator()) {
                                    astPath.replaceWith(t.callExpression(t.identifier('require'), [t.stringLiteral(imageRelativePath)]));
                                }
                                else if (astPath.parentPath.isJSXAttribute()) {
                                    astPath.replaceWith(t.jSXExpressionContainer(t.callExpression(t.identifier('require'), [t.stringLiteral(imageRelativePath)])));
                                }
                            }
                        }
                    });
                    if (lastImport) {
                        if (importStylePath) {
                            lastImport.insertAfter(t.importDeclaration([], t.stringLiteral(util_1.promoteRelativePath(path.relative(sourceFilePath, importStylePath)))));
                        }
                        if (imports && imports.length) {
                            imports.forEach(({ name, ast }) => {
                                const importName = util_1.pascalCase(name);
                                if (componentClassName === importName) {
                                    return;
                                }
                                const importPath = path.join(self.importsDir, importName + '.js');
                                if (!self.hadBeenBuiltImports.has(importPath)) {
                                    self.hadBeenBuiltImports.add(importPath);
                                    self.writeFileToTaro(importPath, prettier.format(astConvert_1.generateMinimalEscapeCode(ast), prettierJSConfig));
                                }
                                lastImport.insertAfter(template(`import ${importName} from '${util_1.promoteRelativePath(path.relative(outputFilePath, importPath))}'`, babylon_1.default)());
                            });
                        }
                        if (depComponents && depComponents.size) {
                            depComponents.forEach(componentObj => {
                                const name = util_1.pascalCase(componentObj.name);
                                const component = componentObj.path;
                                lastImport.insertAfter(template(`import ${name} from '${util_1.promoteRelativePath(path.relative(sourceFilePath, component))}'`, babylon_1.default)());
                            });
                        }
                        if (isApp) {
                            astPath.node.body.push(template(`Taro.render(<App />, document.getElementById('app'))`, babylon_1.default)());
                        }
                    }
                }
            }
        });
        return {
            ast,
            scriptFiles
        };
    }
    getApp() {
        this.entryJSPath = path.join(this.root, `app${this.fileTypes.SCRIPT}`);
        this.entryJSONPath = path.join(this.root, `app${this.fileTypes.CONFIG}`);
        this.entryStylePath = path.join(this.root, `app${this.fileTypes.STYLE}`);
        try {
            this.entryJSON = JSON.parse(String(fs.readFileSync(this.entryJSONPath)));
            util_1.printLog("convert" /* CONVERT */, '入口文件', this.generateShowPath(this.entryJSPath));
            util_1.printLog("convert" /* CONVERT */, '入口配置', this.generateShowPath(this.entryJSONPath));
            if (fs.existsSync(this.entryStylePath)) {
                this.entryStyle = String(fs.readFileSync(this.entryStylePath));
                util_1.printLog("convert" /* CONVERT */, '入口样式', this.generateShowPath(this.entryStylePath));
            }
        }
        catch (err) {
            this.entryJSON = {};
            console.log(chalk_1.default.red(`app${this.fileTypes.CONFIG} 读取失败，请检查！`));
            process.exit(1);
        }
    }
    getPages() {
        const pages = this.entryJSON['pages'];
        if (!pages || !pages.length) {
            console.log(chalk_1.default.red(`app${this.fileTypes.CONFIG} 配置有误，缺少页面相关配置`));
            return;
        }
        this.pages = new Set(pages);
    }
    getSubPackages() {
        const subPackages = this.entryJSON['subpackages'] || this.entryJSON['subPackages'];
        if (!subPackages || !subPackages.length) {
            return;
        }
        subPackages.forEach(item => {
            if (item.pages && item.pages.length) {
                const root = item.root;
                item.pages.forEach(page => {
                    let pagePath = `${root}/${page}`;
                    pagePath = pagePath.replace(/\/{2,}/g, '/');
                    this.pages.add(pagePath);
                });
            }
        });
    }
    generateScriptFiles(files) {
        if (!files) {
            return;
        }
        if (files.size) {
            files.forEach(file => {
                if (!fs.existsSync(file) || this.hadBeenCopyedFiles.has(file)) {
                    return;
                }
                const code = fs.readFileSync(file).toString();
                let outputFilePath = file.replace(this.root, this.convertDir);
                const extname = path.extname(outputFilePath);
                if (/\.wxs/.test(extname)) {
                    outputFilePath += '.js';
                }
                const transformResult = wxTransformer({
                    code,
                    sourcePath: file,
                    outputPath: outputFilePath,
                    isNormal: true,
                    isTyped: constants_1.REG_TYPESCRIPT.test(file)
                });
                const { ast, scriptFiles } = this.parseAst({
                    ast: transformResult.ast,
                    outputFilePath,
                    sourceFilePath: file
                });
                const jsCode = astConvert_1.generateMinimalEscapeCode(ast);
                this.writeFileToTaro(outputFilePath, prettier.format(jsCode, prettierJSConfig));
                util_1.printLog("copy" /* COPY */, 'JS 文件', this.generateShowPath(outputFilePath));
                this.hadBeenCopyedFiles.add(file);
                this.generateScriptFiles(scriptFiles);
            });
        }
    }
    writeFileToTaro(dist, code) {
        fs.ensureDirSync(path.dirname(dist));
        fs.writeFileSync(dist, code);
    }
    copyFileToTaro(from, to, options) {
        const filename = path.basename(from);
        if (fs.statSync(from).isFile() && !path.extname(to)) {
            fs.ensureDir(to);
            return fs.copySync(from, path.join(to, filename), options);
        }
        fs.ensureDir(path.dirname(to));
        return fs.copySync(from, to, options);
    }
    getDistFilePath(src, extname) {
        if (!extname)
            return src.replace(this.root, this.convertDir);
        return src.replace(this.root, this.convertDir).replace(path.extname(src), extname);
    }
    generateShowPath(filePath) {
        return filePath.replace(path.join(this.root, '/'), '').split(path.sep).join('/');
    }
    generateEntry() {
        try {
            const entryJS = String(fs.readFileSync(this.entryJSPath));
            const entryJSON = JSON.stringify(this.entryJSON);
            const entryDistJSPath = this.getDistFilePath(this.entryJSPath);
            const taroizeResult = taroize({
                json: entryJSON,
                script: entryJS,
                path: path.dirname(entryJS)
            });
            const { ast, scriptFiles } = this.parseAst({
                ast: taroizeResult.ast,
                sourceFilePath: this.entryJSPath,
                outputFilePath: entryDistJSPath,
                importStylePath: this.entryStyle ? this.entryStylePath.replace(path.extname(this.entryStylePath), OUTPUT_STYLE_EXTNAME) : null,
                isApp: true
            });
            const jsCode = astConvert_1.generateMinimalEscapeCode(ast);
            this.writeFileToTaro(entryDistJSPath, prettier.format(jsCode, prettierJSConfig));
            util_1.printLog("generate" /* GENERATE */, '入口文件', this.generateShowPath(entryDistJSPath));
            if (this.entryStyle) {
                this.traverseStyle(this.entryStylePath, this.entryStyle);
            }
            this.generateScriptFiles(scriptFiles);
            if (this.entryJSON.tabBar) {
                this.generateTabBarIcon(this.entryJSON.tabBar);
            }
        }
        catch (err) {
            console.log(err);
        }
    }
    generateTabBarIcon(tabBar) {
        const { list = [] } = tabBar;
        const icons = new Set();
        if (Array.isArray(list) && list.length) {
            list.forEach(item => {
                if (typeof item.iconPath === 'string')
                    icons.add(item.iconPath);
                if (typeof item.selectedIconPath === 'string')
                    icons.add(item.selectedIconPath);
            });
            if (icons.size > 0) {
                Array.from(icons)
                    .map(icon => path.join(this.root, icon))
                    .forEach(iconPath => {
                    const iconDistPath = this.getDistFilePath(iconPath);
                    this.copyFileToTaro(iconPath, iconDistPath);
                    util_1.printLog("copy" /* COPY */, 'TabBar 图标', this.generateShowPath(iconDistPath));
                });
            }
        }
    }
    traversePages() {
        this.pages.forEach(page => {
            const pagePath = path.join(this.root, page);
            const pageJSPath = pagePath + this.fileTypes.SCRIPT;
            const pageDistJSPath = this.getDistFilePath(pageJSPath);
            const pageConfigPath = pagePath + this.fileTypes.CONFIG;
            const pageStylePath = pagePath + this.fileTypes.STYLE;
            const pageTemplPath = pagePath + this.fileTypes.TEMPL;
            try {
                const depComponents = new Set();
                if (!fs.existsSync(pageJSPath)) {
                    throw new Error(`页面 ${page} 没有 JS 文件！`);
                }
                const param = {};
                util_1.printLog("convert" /* CONVERT */, '页面文件', this.generateShowPath(pageJSPath));
                if (fs.existsSync(pageConfigPath)) {
                    util_1.printLog("convert" /* CONVERT */, '页面配置', this.generateShowPath(pageConfigPath));
                    const pageConfigStr = String(fs.readFileSync(pageConfigPath));
                    const pageConfig = JSON.parse(pageConfigStr);
                    const pageUsingComponnets = pageConfig.usingComponents;
                    if (pageUsingComponnets) {
                        // 页面依赖组件
                        Object.keys(pageUsingComponnets).forEach(component => {
                            let componentPath = path.resolve(pageConfigPath, '..', pageUsingComponnets[component]);
                            if (!fs.existsSync(util_1.resolveScriptPath(componentPath))) {
                                componentPath = path.join(this.root, pageUsingComponnets[component]);
                            }
                            depComponents.add({
                                name: component,
                                path: componentPath
                            });
                        });
                        delete pageConfig.usingComponents;
                    }
                    param.json = JSON.stringify(pageConfig);
                }
                param.script = String(fs.readFileSync(pageJSPath));
                if (fs.existsSync(pageTemplPath)) {
                    util_1.printLog("convert" /* CONVERT */, '页面模板', this.generateShowPath(pageTemplPath));
                    param.wxml = String(fs.readFileSync(pageTemplPath));
                }
                let pageStyle = null;
                if (fs.existsSync(pageStylePath)) {
                    util_1.printLog("convert" /* CONVERT */, '页面样式', this.generateShowPath(pageStylePath));
                    pageStyle = String(fs.readFileSync(pageStylePath));
                }
                param.path = path.dirname(pageJSPath);
                const taroizeResult = taroize(param);
                const { ast, scriptFiles } = this.parseAst({
                    ast: taroizeResult.ast,
                    sourceFilePath: pageJSPath,
                    outputFilePath: pageDistJSPath,
                    importStylePath: pageStyle ? pageStylePath.replace(path.extname(pageStylePath), OUTPUT_STYLE_EXTNAME) : null,
                    depComponents,
                    imports: taroizeResult.imports
                });
                const jsCode = astConvert_1.generateMinimalEscapeCode(ast);
                this.writeFileToTaro(pageDistJSPath, prettier.format(jsCode, prettierJSConfig));
                util_1.printLog("generate" /* GENERATE */, '页面文件', this.generateShowPath(pageDistJSPath));
                if (pageStyle) {
                    this.traverseStyle(pageStylePath, pageStyle);
                }
                this.generateScriptFiles(scriptFiles);
                this.traverseComponents(depComponents);
            }
            catch (err) {
                util_1.printLog("error" /* ERROR */, '页面转换', this.generateShowPath(pageJSPath));
                console.log(err);
            }
        });
    }
    traverseComponents(components) {
        if (!components || !components.size) {
            return;
        }
        components.forEach(componentObj => {
            const component = componentObj.path;
            if (this.hadBeenBuiltComponents.has(component))
                return;
            this.hadBeenBuiltComponents.add(component);
            const componentJSPath = component + this.fileTypes.SCRIPT;
            const componentDistJSPath = this.getDistFilePath(componentJSPath);
            const componentConfigPath = component + this.fileTypes.CONFIG;
            const componentStylePath = component + this.fileTypes.STYLE;
            const componentTemplPath = component + this.fileTypes.TEMPL;
            try {
                const param = {};
                const depComponents = new Set();
                if (!fs.existsSync(componentJSPath)) {
                    throw new Error(`组件 ${component} 没有 JS 文件！`);
                }
                util_1.printLog("convert" /* CONVERT */, '组件文件', this.generateShowPath(componentJSPath));
                if (fs.existsSync(componentConfigPath)) {
                    util_1.printLog("convert" /* CONVERT */, '组件配置', this.generateShowPath(componentConfigPath));
                    const componentConfigStr = String(fs.readFileSync(componentConfigPath));
                    const componentConfig = JSON.parse(componentConfigStr);
                    const componentUsingComponnets = componentConfig.usingComponents;
                    if (componentUsingComponnets) {
                        // 页面依赖组件
                        Object.keys(componentUsingComponnets).forEach(component => {
                            let componentPath = path.resolve(componentConfigPath, '..', componentUsingComponnets[component]);
                            if (!fs.existsSync(util_1.resolveScriptPath(componentPath))) {
                                componentPath = path.join(this.root, componentUsingComponnets[component]);
                            }
                            depComponents.add({
                                name: component,
                                path: componentPath
                            });
                        });
                        delete componentConfig.usingComponents;
                    }
                    param.json = JSON.stringify(componentConfig);
                }
                param.script = String(fs.readFileSync(componentJSPath));
                if (fs.existsSync(componentTemplPath)) {
                    util_1.printLog("convert" /* CONVERT */, '组件模板', this.generateShowPath(componentTemplPath));
                    param.wxml = String(fs.readFileSync(componentTemplPath));
                }
                let componentStyle = null;
                if (fs.existsSync(componentStylePath)) {
                    util_1.printLog("convert" /* CONVERT */, '组件样式', this.generateShowPath(componentStylePath));
                    componentStyle = String(fs.readFileSync(componentStylePath));
                }
                param.path = path.dirname(componentJSPath);
                const taroizeResult = taroize(param);
                const { ast, scriptFiles } = this.parseAst({
                    ast: taroizeResult.ast,
                    sourceFilePath: componentJSPath,
                    outputFilePath: componentDistJSPath,
                    importStylePath: componentStyle ? componentStylePath.replace(path.extname(componentStylePath), OUTPUT_STYLE_EXTNAME) : null,
                    depComponents,
                    imports: taroizeResult.imports
                });
                const jsCode = astConvert_1.generateMinimalEscapeCode(ast);
                this.writeFileToTaro(componentDistJSPath, prettier.format(jsCode, prettierJSConfig));
                util_1.printLog("generate" /* GENERATE */, '组件文件', this.generateShowPath(componentDistJSPath));
                if (componentStyle) {
                    this.traverseStyle(componentStylePath, componentStyle);
                }
                this.generateScriptFiles(scriptFiles);
                this.traverseComponents(depComponents);
            }
            catch (err) {
                util_1.printLog("error" /* ERROR */, '组件转换', this.generateShowPath(componentJSPath));
                console.log(err);
            }
        });
    }
    styleUnitTransform(filePath, content) {
        return __awaiter(this, void 0, void 0, function* () {
            const postcssResult = yield postcss([
                unitTransform()
            ]).process(content, {
                from: filePath
            });
            return postcssResult;
        });
    }
    traverseStyle(filePath, style) {
        return __awaiter(this, void 0, void 0, function* () {
            const { imports, content } = util_1.processStyleImports(style, "weapp" /* WEAPP */, (str, stylePath) => {
                let relativePath = stylePath;
                if (path.isAbsolute(relativePath)) {
                    relativePath = util_1.promoteRelativePath(path.relative(filePath, path.join(this.root, stylePath)));
                }
                return str.replace(stylePath, relativePath)
                    .replace(constants_1.MINI_APP_FILES["weapp" /* WEAPP */].STYLE, OUTPUT_STYLE_EXTNAME);
            });
            const styleDist = this.getDistFilePath(filePath, OUTPUT_STYLE_EXTNAME);
            const { css } = yield this.styleUnitTransform(filePath, content);
            this.writeFileToTaro(styleDist, css);
            util_1.printLog("generate" /* GENERATE */, '样式文件', this.generateShowPath(styleDist));
            if (imports && imports.length) {
                imports.forEach(importItem => {
                    const importPath = path.isAbsolute(importItem)
                        ? path.join(this.root, importItem)
                        : path.resolve(path.dirname(filePath), importItem);
                    if (fs.existsSync(importPath)) {
                        const styleText = fs.readFileSync(importPath).toString();
                        this.traverseStyle(importPath, styleText);
                    }
                });
            }
        });
    }
    generateConfigFiles() {
        const creator = new creator_1.default();
        const templateName = 'default';
        const configDir = path.join(this.convertRoot, 'config');
        const pkgPath = path.join(this.convertRoot, 'package.json');
        const projectName = 'taroConvert';
        const description = '';
        const version = util_1.getPkgVersion();
        const dateObj = new Date();
        const date = `${dateObj.getFullYear()}-${(dateObj.getMonth() + 1)}-${dateObj.getDate()}`;
        creator.template(templateName, 'pkg', pkgPath, {
            description,
            projectName,
            version,
            css: 'sass',
            typescript: false,
            template: templateName
        });
        creator.template(templateName, path.join('config', 'index'), path.join(configDir, 'index.js'), {
            date,
            projectName
        });
        creator.template(templateName, path.join('config', 'dev'), path.join(configDir, 'dev.js'));
        creator.template(templateName, path.join('config', 'prod'), path.join(configDir, 'prod.js'));
        creator.template(templateName, 'project', path.join(this.convertRoot, 'project.config.json'), {
            description,
            projectName
        });
        creator.template(templateName, 'gitignore', path.join(this.convertRoot, '.gitignore'));
        creator.template(templateName, 'editorconfig', path.join(this.convertRoot, '.editorconfig'));
        creator.template(templateName, 'eslintrc', path.join(this.convertRoot, '.eslintrc'), {
            typescript: false
        });
        creator.template(templateName, 'indexhtml', path.join(this.convertDir, 'index.html'));
        creator.fs.commit(() => {
            const pkgObj = JSON.parse(fs.readFileSync(pkgPath).toString());
            pkgObj.dependencies['@tarojs/with-weapp'] = `^${version}`;
            fs.writeJSONSync(pkgPath, pkgObj, {
                spaces: 2,
                EOL: '\n'
            });
            util_1.printLog("generate" /* GENERATE */, '文件', this.generateShowPath(path.join(configDir, 'index.js')));
            util_1.printLog("generate" /* GENERATE */, '文件', this.generateShowPath(path.join(configDir, 'dev.js')));
            util_1.printLog("generate" /* GENERATE */, '文件', this.generateShowPath(path.join(configDir, 'prod.js')));
            util_1.printLog("generate" /* GENERATE */, '文件', this.generateShowPath(pkgPath));
            util_1.printLog("generate" /* GENERATE */, '文件', this.generateShowPath(path.join(this.convertRoot, 'project.config.json')));
            util_1.printLog("generate" /* GENERATE */, '文件', this.generateShowPath(path.join(this.convertRoot, '.gitignore')));
            util_1.printLog("generate" /* GENERATE */, '文件', this.generateShowPath(path.join(this.convertRoot, '.editorconfig')));
            util_1.printLog("generate" /* GENERATE */, '文件', this.generateShowPath(path.join(this.convertRoot, '.eslintrc')));
            util_1.printLog("generate" /* GENERATE */, '文件', this.generateShowPath(path.join(this.convertDir, 'index.html')));
        });
    }
    run() {
        this.generateEntry();
        this.traversePages();
        this.generateConfigFiles();
    }
}
exports.default = Convertor;

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
const wxTransformer = require("@tarojs/transformer-wx");
const babel = require("babel-core");
const babel_traverse_1 = require("babel-traverse");
const t = require("babel-types");
const better_babel_generator_1 = require("better-babel-generator");
const chokidar = require("chokidar");
const fs = require("fs-extra");
const klaw = require("klaw");
const lodash_1 = require("lodash");
const path = require("path");
const config_1 = require("../config");
const util_1 = require("../util");
const astConvert_1 = require("../util/astConvert");
const constants_1 = require("../util/constants");
const npmProcess = require("../util/npm");
const constants_2 = require("./constants");
const helper_1 = require("./helper");
class Compiler {
    constructor(appPath) {
        this.pages = [];
        const projectConfig = util_1.recursiveMerge({
            h5: {
                router: {
                    mode: 'hash',
                    customRoutes: {}
                }
            }
        }, require(path.join(appPath, constants_1.PROJECT_CONFIG))(lodash_1.merge));
        this.projectConfig = projectConfig;
        const sourceDir = projectConfig.sourceRoot || config_1.default.SOURCE_DIR;
        this.sourceRoot = sourceDir;
        const outputDir = projectConfig.outputRoot || config_1.default.OUTPUT_DIR;
        this.outputDir = outputDir;
        this.h5Config = projectConfig.h5;
        const routerConfig = this.h5Config.router;
        this.appPath = appPath;
        this.routerMode = routerConfig.mode;
        this.customRoutes = routerConfig.customRoutes;
        this.routerBasename = helper_1.addLeadingSlash(helper_1.stripTrailingSlash(routerConfig.basename || '/'));
        this.sourcePath = path.join(appPath, sourceDir);
        this.outputPath = path.join(appPath, outputDir);
        this.tempDir = config_1.default.TEMP_DIR;
        this.tempPath = path.join(appPath, this.tempDir);
        this.entryFilePath = util_1.resolveScriptPath(path.join(this.sourcePath, config_1.default.ENTRY));
        this.entryFileName = path.basename(this.entryFilePath);
        this.pathAlias = projectConfig.alias || {};
        this.pxTransformConfig = { designWidth: projectConfig.designWidth || 750 };
        if (projectConfig.hasOwnProperty(constants_2.deviceRatioConfigName)) {
            this.pxTransformConfig.deviceRatio = projectConfig.deviceRatio;
        }
    }
    clean() {
        return __awaiter(this, void 0, void 0, function* () {
            const tempPath = this.tempPath;
            const outputPath = this.outputPath;
            try {
                yield helper_1.pRimraf(tempPath);
                yield helper_1.pRimraf(outputPath);
            }
            catch (e) {
                console.log(e);
            }
        });
    }
    copyFiles() { }
    classifyFiles(filename) {
        const pages = this.pages;
        const appPath = this.appPath;
        const entryFilePath = this.entryFilePath;
        const relPath = path.normalize(path.relative(appPath, filename));
        if (path.relative(filename, entryFilePath) === '')
            return constants_2.FILE_TYPE.ENTRY;
        let relSrcPath = path.relative('src', relPath);
        relSrcPath = path.format({
            dir: path.dirname(relSrcPath),
            base: path.basename(relSrcPath, path.extname(relSrcPath))
        });
        const isPage = pages.some(page => {
            const relPage = path.normalize(path.relative(appPath, page));
            if (path.relative(relPage, relSrcPath) === '')
                return true;
            return false;
        });
        if (isPage) {
            return constants_2.FILE_TYPE.PAGE;
        }
        else {
            return constants_2.FILE_TYPE.NORMAL;
        }
    }
    buildTemp() {
        const tempPath = this.tempPath;
        const sourcePath = this.sourcePath;
        const appPath = this.appPath;
        fs.ensureDirSync(tempPath);
        return new Promise((resolve, reject) => {
            klaw(sourcePath)
                .on('data', file => {
                    const relativePath = path.relative(appPath, file.path);
                    if (!file.stats.isDirectory()) {
                        util_1.printLog("create" /* CREATE */, '发现文件', relativePath);
                        this.processFiles(file.path);
                    }
                })
                .on('end', () => {
                    resolve();
                });
        });
    }
    buildDist({ watch, port }) {
        return __awaiter(this, void 0, void 0, function* () {
            const entryFileName = this.entryFileName;
            const projectConfig = this.projectConfig;
            const h5Config = this.h5Config;
            const outputDir = this.outputDir;
            const sourceRoot = this.sourceRoot;
            const tempPath = this.tempPath;
            const entryFile = path.basename(entryFileName, path.extname(entryFileName)) + '.js';
            // const sourceRoot = projectConfig.sourceRoot || CONFIG.SOURCE_DIR
            if (projectConfig.deviceRatio) {
                h5Config.deviceRatio = projectConfig.deviceRatio;
            }
            if (projectConfig.env) {
                h5Config.env = projectConfig.env;
            }
            util_1.recursiveMerge(h5Config, {
                copy: projectConfig.copy,
                defineConstants: projectConfig.defineConstants,
                designWidth: projectConfig.designWidth,
                entry: {
                    app: [path.join(tempPath, entryFile)]
                },
                env: {
                    TARO_ENV: JSON.stringify("h5" /* H5 */)
                },
                isWatch: !!watch,
                outputRoot: outputDir,
                plugins: projectConfig.plugins,
                port,
                sourceRoot
            });
            const webpackRunner = yield npmProcess.getNpmPkg('@tarojs/webpack-runner', this.appPath);
            webpackRunner(this.appPath, h5Config);
        });
    }
    watchFiles() {
        const sourcePath = this.sourcePath;
        const appPath = this.appPath;
        const watcher = chokidar.watch(path.join(sourcePath), {
            ignored: /(^|[/\\])\../,
            persistent: true,
            ignoreInitial: true
        });
        watcher
            .on('add', filePath => {
                const relativePath = path.relative(appPath, filePath);
                util_1.printLog("create" /* CREATE */, '添加文件', relativePath);
                this.processFiles(filePath);
            })
            .on('change', filePath => {
                const relativePath = path.relative(appPath, filePath);
                util_1.printLog("modify" /* MODIFY */, '文件变动', relativePath);
                this.processFiles(filePath);
            })
            .on('unlink', filePath => {
                const relativePath = path.relative(appPath, filePath);
                const extname = path.extname(relativePath);
                const isScriptFile = constants_1.REG_SCRIPTS.test(extname);
                const dist = this.getDist(filePath, isScriptFile);
                util_1.printLog("unlink" /* UNLINK */, '删除文件', relativePath);
                fs.unlinkSync(dist);
            });
    }
    processEntry(code, filePath) {
        const pages = this.pages;
        const routerMode = this.routerMode;
        const routerBasename = this.routerBasename;
        const customRoutes = this.customRoutes;
        const pathAlias = this.pathAlias;
        const pxTransformConfig = this.pxTransformConfig;
        let ast = wxTransformer({
            code,
            sourcePath: filePath,
            isNormal: true,
            isTyped: constants_1.REG_TYPESCRIPT.test(filePath),
            adapter: 'h5'
        }).ast;
        let taroImportDefaultName;
        let providorImportName;
        let storeName;
        let renderCallCode;
        let tabBar;
        let tabbarPos;
        let hasConstructor = false;
        let hasComponentWillMount = false;
        let hasComponentDidMount = false;
        let hasComponentDidShow = false;
        let hasComponentDidHide = false;
        let hasComponentWillUnmount = false;
        let hasJSX = false;
        let hasNerv = false;
        let stateNode;
        const initPxTransformNode = astConvert_1.convertSourceStringToAstExpression(`Taro.initPxTransform(${JSON.stringify(pxTransformConfig)})`);
        const additionalConstructorNode = astConvert_1.convertSourceStringToAstExpression(`Taro._$app = this`);
        const callComponentDidShowNode = astConvert_1.convertSourceStringToAstExpression(`this.componentDidShow()`);
        const callComponentDidHideNode = astConvert_1.convertSourceStringToAstExpression(`this.componentDidHide()`);
        const initTabbarApiNode = astConvert_1.convertSourceStringToAstExpression(`Taro.initTabBarApis(this, Taro)`);
        ast = babel.transformFromAst(ast, '', {
            plugins: [
                [require('babel-plugin-danger-remove-unused-import'), { ignore: ['@tarojs/taro', 'react', 'nervjs'] }]
            ]
        }).ast;
        const ClassDeclarationOrExpression = {
            enter(astPath) {
                const node = astPath.node;
                if (!node.superClass)
                    return;
                if (node.superClass.type === 'MemberExpression' &&
                    node.superClass.object.name === taroImportDefaultName &&
                    (node.superClass.property.name === 'Component' ||
                        node.superClass.property.name === 'PureComponent')) {
                    node.superClass.object.name = taroImportDefaultName;
                    if (node.id === null) {
                        const renameComponentClassName = '_TaroComponentClass';
                        astPath.replaceWith(t.classExpression(t.identifier(renameComponentClassName), node.superClass, node.body, node.decorators || []));
                    }
                }
                else if (node.superClass.name === 'Component' ||
                    node.superClass.name === 'PureComponent') {
                    helper_1.resetTSClassProperty(node.body.body);
                    if (node.id === null) {
                        const renameComponentClassName = '_TaroComponentClass';
                        astPath.replaceWith(t.classExpression(t.identifier(renameComponentClassName), node.superClass, node.body, node.decorators || []));
                    }
                }
            }
        };
        /**
         * ProgramExit使用的visitor
         * 负责修改render函数的内容，在componentDidMount中增加componentDidShow调用，在componentWillUnmount中增加componentDidHide调用。
         */
        const programExitVisitor = {
            ClassMethod: {
                exit(astPath) {
                    const node = astPath.node;
                    const key = node.key;
                    const keyName = astConvert_1.convertAstExpressionToVariable(key);
                    let funcBody;
                    const isRender = keyName === 'render';
                    const isComponentWillMount = keyName === 'componentWillMount';
                    const isComponentDidMount = keyName === 'componentDidMount';
                    const isComponentWillUnmount = keyName === 'componentWillUnmount';
                    const isConstructor = keyName === 'constructor';
                    if (isRender) {
                        const routes = pages.map((v, k) => {
                            const absPagename = helper_1.addLeadingSlash(v);
                            const relPagename = `.${absPagename}`;
                            const chunkName = relPagename.split('/').filter(v => !/^(pages|\.)$/i.test(v)).join('_');
                            return helper_1.createRoute({
                                absPagename,
                                relPagename,
                                chunkName,
                                isIndex: k === 0
                            });
                        });
                        funcBody = `
              <Router
                history={_taroHistory}
                routes={[${routes.join(',')}]}
                customRoutes={${JSON.stringify(customRoutes)}} />
              `;
                        /* 插入Tabbar */
                        if (tabBar) {
                            const homePage = pages[0] || '';
                            if (tabbarPos === 'top') {
                                funcBody = `
                  <${constants_2.tabBarContainerComponentName}>

                    <${constants_2.tabBarComponentName}
                      conf={this.state.${constants_2.tabBarConfigName}}
                      homePage="${homePage}"
                      tabbarPos={'top'} />

                    <${constants_2.tabBarPanelComponentName}>
                      ${funcBody}
                    </${constants_2.tabBarPanelComponentName}>

                  </${constants_2.tabBarContainerComponentName}>`;
                            }
                            else {
                                funcBody = `
                  <${constants_2.tabBarContainerComponentName}>

                    <${constants_2.tabBarPanelComponentName}>
                      ${funcBody}
                    </${constants_2.tabBarPanelComponentName}>

                    <${constants_2.tabBarComponentName}
                      conf={this.state.${constants_2.tabBarConfigName}}
                      homePage="${homePage}"
                      router={${taroImportDefaultName}} />

                  </${constants_2.tabBarContainerComponentName}>`;
                            }
                        }
                        /* 插入<Provider /> */
                        if (constants_2.providerComponentName && storeName) {
                            // 使用redux 或 mobx
                            funcBody = `
                <${providorImportName} store={${storeName}}>
                  ${funcBody}
                </${providorImportName}>`;
                        }
                        /* 插入<Router /> */
                        node.body = astConvert_1.convertSourceStringToAstExpression(`{return (${funcBody});}`, { preserveComments: true });
                    }
                    if (tabBar && isComponentWillMount) {
                        node.body.body.push(initTabbarApiNode);
                    }
                    if (hasConstructor && isConstructor) {
                        node.body.body.push(additionalConstructorNode);
                    }
                    if (hasComponentDidShow && isComponentDidMount) {
                        node.body.body.push(callComponentDidShowNode);
                    }
                    if (hasComponentDidHide && isComponentWillUnmount) {
                        node.body.body.unshift(callComponentDidHideNode);
                    }
                }
            },
            ClassBody: {
                exit(astPath) {
                    const node = astPath.node;
                    if (hasComponentDidShow && !hasComponentDidMount) {
                        node.body.push(t.classMethod('method', t.identifier('componentDidMount'), [], t.blockStatement([callComponentDidShowNode]), false, false));
                    }
                    if (hasComponentDidHide && !hasComponentWillUnmount) {
                        node.body.push(t.classMethod('method', t.identifier('componentWillUnmount'), [], t.blockStatement([callComponentDidHideNode]), false, false));
                    }
                    if (!hasConstructor) {
                        node.body.push(t.classMethod('method', t.identifier('constructor'), [t.identifier('props'), t.identifier('context')], t.blockStatement([astConvert_1.convertSourceStringToAstExpression('super(props, context)'), additionalConstructorNode]), false, false));
                    }
                    if (tabBar) {
                        if (!hasComponentWillMount) {
                            node.body.push(t.classMethod('method', t.identifier('componentWillMount'), [], t.blockStatement([initTabbarApiNode]), false, false));
                        }
                        if (!stateNode) {
                            stateNode = t.classProperty(t.identifier('state'), t.objectExpression([]));
                            node.body.unshift(stateNode);
                        }
                        if (t.isObjectExpression(stateNode.value)) {
                            stateNode.value.properties.push(t.objectProperty(t.identifier(constants_2.tabBarConfigName), tabBar));
                        }
                    }
                }
            }
        };
        /**
         * ClassProperty使用的visitor
         * 负责收集config中的pages，收集tabbar的position，替换icon。
         */
        const classPropertyVisitor = {
            ObjectProperty(astPath) {
                const node = astPath.node;
                const key = node.key;
                const value = node.value;
                const keyName = astConvert_1.convertAstExpressionToVariable(key);
                if (keyName === 'pages' && t.isArrayExpression(value)) {
                    const subPackageParent = astPath.findParent(helper_1.isUnderSubPackages);
                    let root = '';
                    if (subPackageParent) {
                        /* 在subPackages属性下，说明是分包页面，需要处理root属性 */
                        const parent = astPath.parent;
                        const rootNode = parent.properties.find(v => {
                            if (t.isSpreadProperty(v))
                                return false;
                            return astConvert_1.convertAstExpressionToVariable(v.key) === 'root';
                        });
                        root = rootNode ? astConvert_1.convertAstExpressionToVariable(rootNode.value) : '';
                    }
                    value.elements.forEach(v => {
                        const pagePath = `${root}/${v.value}`.replace(/\/{2,}/g, '/');
                        pages.push(helper_1.removeLeadingSlash(pagePath));
                        v.value = helper_1.addLeadingSlash(v.value);
                    });
                }
                else if (keyName === 'tabBar' && t.isObjectExpression(value)) {
                    // tabBar相关处理
                    tabBar = value;
                    value.properties.forEach((node) => {
                        if (t.isSpreadProperty(node))
                            return;
                        switch (astConvert_1.convertAstExpressionToVariable(node.key)) {
                            case 'position':
                                tabbarPos = astConvert_1.convertAstExpressionToVariable(node.value);
                                break;
                            case 'list':
                                t.isArrayExpression(node.value) && node.value.elements.forEach(v => {
                                    if (!t.isObjectExpression(v))
                                        return;
                                    v.properties.forEach(property => {
                                        if (!t.isObjectProperty(property))
                                            return;
                                        switch (astConvert_1.convertAstExpressionToVariable(property.key)) {
                                            case 'iconPath':
                                            case 'selectedIconPath':
                                                if (t.isStringLiteral(property.value)) {
                                                    property.value = t.callExpression(t.identifier('require'), [t.stringLiteral(`./${property.value.value}`)]);
                                                }
                                                break;
                                            case 'pagePath':
                                                property.value = t.stringLiteral(helper_1.addLeadingSlash(astConvert_1.convertAstExpressionToVariable(property.value)));
                                                break;
                                        }
                                    });
                                });
                        }
                    });
                    value.properties.push(t.objectProperty(t.identifier('mode'), t.stringLiteral(routerMode)));
                    value.properties.push(t.objectProperty(t.identifier('basename'), t.stringLiteral(routerBasename)));
                    value.properties.push(t.objectProperty(t.identifier('customRoutes'), t.objectExpression(astConvert_1.convertObjectToAstExpression(customRoutes))));
                }
            }
        };
        babel_traverse_1.default(ast, {
            ClassExpression: ClassDeclarationOrExpression,
            ClassDeclaration: ClassDeclarationOrExpression,
            ClassProperty: {
                enter(astPath) {
                    const node = astPath.node;
                    const key = node.key;
                    const keyName = astConvert_1.convertAstExpressionToVariable(key);
                    if (keyName === 'state') {
                        stateNode = node;
                    }
                    else if (keyName === 'config') {
                        // appConfig = toVar(node.value)
                        astPath.traverse(classPropertyVisitor);
                    }
                }
            },
            ImportDeclaration: {
                enter(astPath) {
                    const node = astPath.node;
                    const source = node.source;
                    const specifiers = node.specifiers;
                    let value = source.value;
                    if (util_1.isAliasPath(value, pathAlias)) {
                        source.value = value = util_1.replaceAliasPath(filePath, value, pathAlias);
                    }
                    if (!util_1.isNpmPkg(value)) {
                        if (value.indexOf('.') === 0) {
                            const pathArr = value.split('/');
                            if (pathArr.indexOf('pages') >= 0) {
                                astPath.remove();
                            }
                            else if (constants_1.REG_SCRIPTS.test(value) || path.extname(value) === '') {
                                const absolutePath = path.resolve(filePath, '..', value);
                                const dirname = path.dirname(absolutePath);
                                const extname = path.extname(absolutePath);
                                const realFilePath = util_1.resolveScriptPath(path.join(dirname, path.basename(absolutePath, extname)));
                                const removeExtPath = realFilePath.replace(path.extname(realFilePath), '');
                                node.source = t.stringLiteral(util_1.promoteRelativePath(path.relative(filePath, removeExtPath)).replace(/\\/g, '/'));
                            }
                        }
                        return;
                    }
                    if (value === '@tarojs/taro') {
                        source.value = '@tarojs/taro-h5';
                        const specifier = specifiers.find(item => t.isImportDefaultSpecifier(item));
                        if (specifier) {
                            taroImportDefaultName = astConvert_1.convertAstExpressionToVariable(specifier.local);
                        }
                    }
                    else if (value === '@tarojs/redux') {
                        const specifier = specifiers.find(item => {
                            return t.isImportSpecifier(item) && item.imported.name === constants_2.providerComponentName;
                        });
                        if (specifier) {
                            providorImportName = specifier.local.name;
                        }
                        else {
                            providorImportName = constants_2.providerComponentName;
                            specifiers.push(t.importSpecifier(t.identifier(constants_2.providerComponentName), t.identifier(constants_2.providerComponentName)));
                        }
                        source.value = '@tarojs/redux-h5';
                    }
                    else if (value === '@tarojs/mobx') {
                        const specifier = specifiers.find(item => {
                            return t.isImportSpecifier(item) && item.imported.name === constants_2.providerComponentName;
                        });
                        if (specifier) {
                            providorImportName = specifier.local.name;
                        }
                        else {
                            providorImportName = constants_2.providerComponentName;
                            specifiers.push(t.importSpecifier(t.identifier(constants_2.providerComponentName), t.identifier(constants_2.providerComponentName)));
                        }
                        source.value = '@tarojs/mobx-h5';
                    }
                    else if (value === 'nervjs') {
                        hasNerv = true;
                        const defaultSpecifier = specifiers.find(item => t.isImportDefaultSpecifier(item));
                        if (!defaultSpecifier) {
                            specifiers.unshift(t.importDefaultSpecifier(t.identifier(constants_2.nervJsImportDefaultName)));
                        }
                    }
                }
            },
            CallExpression: {
                enter(astPath) {
                    const node = astPath.node;
                    const callee = node.callee;
                    const calleeName = astConvert_1.convertAstExpressionToVariable(callee);
                    const parentPath = astPath.parentPath;
                    if (t.isMemberExpression(callee)) {
                        const object = callee.object;
                        const property = callee.property;
                        if (object.name === taroImportDefaultName && property.name === 'render') {
                            object.name = constants_2.nervJsImportDefaultName;
                            renderCallCode = better_babel_generator_1.default(astPath.node).code;
                            astPath.remove();
                        }
                    }
                    else {
                        if (calleeName === constants_2.setStoreFuncName) {
                            if (parentPath.isAssignmentExpression() ||
                                parentPath.isExpressionStatement() ||
                                parentPath.isVariableDeclarator()) {
                                parentPath.remove();
                            }
                        }
                    }
                }
            },
            ClassMethod: {
                exit(astPath) {
                    const node = astPath.node;
                    const key = node.key;
                    const keyName = astConvert_1.convertAstExpressionToVariable(key);
                    if (keyName === 'constructor') {
                        hasConstructor = true;
                    }
                    else if (keyName === 'componentWillMount') {
                        hasComponentWillMount = true;
                    }
                    else if (keyName === 'componentDidMount') {
                        hasComponentDidMount = true;
                    }
                    else if (keyName === 'componentDidShow') {
                        hasComponentDidShow = true;
                    }
                    else if (keyName === 'componentDidHide') {
                        hasComponentDidHide = true;
                    }
                    else if (keyName === 'componentWillUnmount') {
                        hasComponentWillUnmount = true;
                    }
                }
            },
            JSXElement: {
                enter(astPath) {
                    hasJSX = true;
                }
            },
            JSXOpeningElement: {
                enter(astPath) {
                    const node = astPath.node;
                    if (astConvert_1.convertAstExpressionToVariable(node.name) === 'Provider') {
                        for (const v of node.attributes) {
                            if (v.name.name !== 'store')
                                continue;
                            if (!t.isJSXExpressionContainer(v.value))
                                return;
                            storeName = astConvert_1.convertAstExpressionToVariable(v.value.expression);
                            break;
                        }
                    }
                }
            },
            Program: {
                exit(astPath) {
                    const node = astPath.node;
                    const importRouterNode = astConvert_1.convertSourceStringToAstExpression(`import { Router, createHistory, mountApis } from '${'@tarojs/router'}'`);
                    const importComponentNode = astConvert_1.convertSourceStringToAstExpression(`import { View, ${constants_2.tabBarComponentName}, ${constants_2.tabBarContainerComponentName}, ${constants_2.tabBarPanelComponentName}} from '${'@tarojs/components'}'`);
                    const lastImportIndex = lodash_1.findLastIndex(astPath.node.body, t.isImportDeclaration);
                    const lastImportNode = astPath.get(`body.${lastImportIndex > -1 ? lastImportIndex : 0}`);
                    const createHistoryNode = astConvert_1.convertSourceStringToAstExpression(`
            const _taroHistory = createHistory({
              mode: "${routerMode}",
              basename: "${routerBasename}",
              customRoutes: ${JSON.stringify(customRoutes)},
              firstPagePath: "${helper_1.addLeadingSlash(pages[0])}"
            });
          `);
                    const mountApisNode = astConvert_1.convertSourceStringToAstExpression(`mountApis(_taroHistory);`);
                    const extraNodes = [
                        importRouterNode,
                        initPxTransformNode,
                        createHistoryNode,
                        mountApisNode
                    ];
                    astPath.traverse(programExitVisitor);
                    if (hasJSX && !hasNerv) {
                        extraNodes.unshift(t.importDeclaration([t.importDefaultSpecifier(t.identifier(constants_2.nervJsImportDefaultName))], t.stringLiteral('nervjs')));
                    }
                    if (tabBar) {
                        extraNodes.unshift(importComponentNode);
                    }
                    lastImportNode.insertAfter(extraNodes);
                    if (renderCallCode) {
                        const renderCallNode = astConvert_1.convertSourceStringToAstExpression(renderCallCode);
                        node.body.push(renderCallNode);
                    }
                }
            }
        });
        const generateCode = better_babel_generator_1.default(ast, {
            jsescOption: {
                minimal: true
            }
        }).code;
        return {
            code: generateCode,
            ast
        };
    }
    processOthers(code, filePath, fileType) {
        const pathAlias = this.pathAlias;
        const componentnameMap = new Map();
        const taroapiMap = new Map();
        const isPage = fileType === constants_2.FILE_TYPE.PAGE;
        let ast = wxTransformer({
            code,
            sourcePath: filePath,
            isNormal: true,
            isTyped: constants_1.REG_TYPESCRIPT.test(filePath),
            adapter: 'h5'
        }).ast;
        let taroImportDefaultName;
        let hasJSX = false;
        let hasOnPageScroll = false;
        let hasOnReachBottom = false;
        let hasOnPullDownRefresh = false;
        let pageConfig = {};
        let componentDidMountNode;
        let componentDidShowNode;
        let componentDidHideNode;
        let importTaroComponentNode;
        let importNervNode;
        let importTaroNode;
        let renderClassMethodNode;
        const renderReturnStatementPaths = [];
        ast = babel.transformFromAst(ast, '', {
            plugins: [
                [require('babel-plugin-danger-remove-unused-import'), { ignore: ['@tarojs/taro', 'react', 'nervjs'] }]
            ]
        }).ast;
        const ClassDeclarationOrExpression = {
            enter(astPath) {
                const node = astPath.node;
                if (!node.superClass)
                    return;
                if (node.superClass.type === 'MemberExpression' &&
                    node.superClass.object.name === taroImportDefaultName &&
                    (node.superClass.property.name === 'Component' ||
                        node.superClass.property.name === 'PureComponent')) {
                    node.superClass.object.name = taroImportDefaultName;
                    if (node.id === null) {
                        const renameComponentClassName = '_TaroComponentClass';
                        astPath.replaceWith(t.classExpression(t.identifier(renameComponentClassName), node.superClass, node.body, node.decorators || []));
                    }
                }
                else if (node.superClass.name === 'Component' ||
                    node.superClass.name === 'PureComponent') {
                    helper_1.resetTSClassProperty(node.body.body);
                    if (node.id === null) {
                        const renameComponentClassName = '_TaroComponentClass';
                        astPath.replaceWith(t.classExpression(t.identifier(renameComponentClassName), node.superClass, node.body, node.decorators || []));
                    }
                }
            }
        };
        const getComponentId = (componentName, node) => {
            const idAttrName = constants_2.MAP_FROM_COMPONENTNAME_TO_ID.get(componentName);
            return node.attributes.reduce((prev, attribute) => {
                if (prev)
                    return prev;
                const attrName = astConvert_1.convertAstExpressionToVariable(attribute.name);
                if (attrName === idAttrName)
                    return astConvert_1.convertAstExpressionToVariable(attribute.value);
                else
                    return false;
            }, false);
        };
        const getComponentRef = (node) => {
            return node.attributes.find(attribute => {
                return astConvert_1.convertAstExpressionToVariable(attribute.name) === 'ref';
            });
        };
        const createRefFunc = (componentId) => {
            return t.arrowFunctionExpression([t.identifier('ref')], t.blockStatement([
                astConvert_1.convertSourceStringToAstExpression(`this['__taroref_${componentId}'] = ref`)
            ]));
        };
        const defaultVisitor = {
            ClassExpression: ClassDeclarationOrExpression,
            ClassDeclaration: ClassDeclarationOrExpression,
            ImportDeclaration: {
                enter(astPath) {
                    const node = astPath.node;
                    const source = node.source;
                    let value = source.value;
                    const specifiers = node.specifiers;
                    if (util_1.isAliasPath(value, pathAlias)) {
                        source.value = value = util_1.replaceAliasPath(filePath, value, pathAlias);
                    }
                    if (!util_1.isNpmPkg(value)) {
                        if (constants_1.REG_SCRIPTS.test(value) || path.extname(value) === '') {
                            const absolutePath = path.resolve(filePath, '..', value);
                            const dirname = path.dirname(absolutePath);
                            const extname = path.extname(absolutePath);
                            const realFilePath = util_1.resolveScriptPath(path.join(dirname, path.basename(absolutePath, extname)));
                            const removeExtPath = realFilePath.replace(path.extname(realFilePath), '');
                            node.source = t.stringLiteral(util_1.promoteRelativePath(path.relative(filePath, removeExtPath)).replace(/\\/g, '/'));
                        }
                    }
                    else if (value === '@tarojs/taro') {
                        importTaroNode = node;
                        source.value = '@tarojs/taro-h5';
                        specifiers.forEach(specifier => {
                            if (t.isImportDefaultSpecifier(specifier)) {
                                taroImportDefaultName = astConvert_1.convertAstExpressionToVariable(specifier.local);
                            }
                            else if (t.isImportSpecifier(specifier)) {
                                taroapiMap.set(astConvert_1.convertAstExpressionToVariable(specifier.local), astConvert_1.convertAstExpressionToVariable(specifier.imported));
                            }
                        });
                    }
                    else if (value === '@tarojs/redux') {
                        source.value = '@tarojs/redux-h5';
                    }
                    else if (value === '@tarojs/mobx') {
                        source.value = '@tarojs/mobx-h5';
                    }
                    else if (value === '@tarojs/components') {
                        importTaroComponentNode = node;
                        node.specifiers.forEach((specifier) => {
                            if (!t.isImportSpecifier(specifier))
                                return;
                            componentnameMap.set(astConvert_1.convertAstExpressionToVariable(specifier.local), astConvert_1.convertAstExpressionToVariable(specifier.imported));
                        });
                    }
                    else if (value === 'nervjs') {
                        importNervNode = node;
                    }
                }
            },
            JSXOpeningElement: {
                exit(astPath) {
                    hasJSX = true;
                    const node = astPath.node;
                    const componentName = componentnameMap.get(astConvert_1.convertAstExpressionToVariable(node.name));
                    const componentId = getComponentId(componentName, node);
                    const componentRef = getComponentRef(node);
                    if (!componentId)
                        return;
                    const refFunc = createRefFunc(componentId);
                    if (componentRef) {
                        const expression = componentRef.value.expression;
                        refFunc.body.body.unshift(t.expressionStatement(t.callExpression(expression, [t.identifier('ref')])));
                        componentRef.value.expression = refFunc;
                    }
                    else {
                        node.attributes.push(t.jSXAttribute(t.jSXIdentifier('ref'), t.jSXExpressionContainer(refFunc)));
                    }
                }
            },
            CallExpression: {
                exit(astPath) {
                    const node = astPath.node;
                    const callee = node.callee;
                    let needToAppendThis = false;
                    let funcName = '';
                    if (t.isMemberExpression(callee)) {
                        const objName = astConvert_1.convertAstExpressionToVariable(callee.object);
                        const tmpFuncName = astConvert_1.convertAstExpressionToVariable(callee.property);
                        if (objName === taroImportDefaultName && constants_2.APIS_NEED_TO_APPEND_THIS.has(tmpFuncName)) {
                            needToAppendThis = true;
                            funcName = tmpFuncName;
                        }
                    }
                    else if (t.isIdentifier(callee)) {
                        const tmpFuncName = astConvert_1.convertAstExpressionToVariable(callee);
                        const oriFuncName = taroapiMap.get(tmpFuncName);
                        if (constants_2.APIS_NEED_TO_APPEND_THIS.has(oriFuncName)) {
                            needToAppendThis = true;
                            funcName = oriFuncName;
                        }
                    }
                    if (needToAppendThis) {
                        const thisOrder = constants_2.APIS_NEED_TO_APPEND_THIS.get(funcName);
                        if (thisOrder && !node.arguments[thisOrder]) {
                            node.arguments[thisOrder] = t.thisExpression();
                        }
                    }
                }
            },
            Program: {
                exit(astPath) {
                    const node = astPath.node;
                    if (hasJSX) {
                        if (!importNervNode) {
                            importNervNode = t.importDeclaration([t.importDefaultSpecifier(t.identifier(constants_2.nervJsImportDefaultName))], t.stringLiteral('nervjs'));
                            const specifiers = importNervNode.specifiers;
                            const defaultSpecifier = specifiers.find(item => t.isImportDefaultSpecifier(item));
                            if (!defaultSpecifier) {
                                specifiers.unshift(t.importDefaultSpecifier(t.identifier(constants_2.nervJsImportDefaultName)));
                            }
                            node.body.unshift(importNervNode);
                        }
                        if (!importTaroNode) {
                            importTaroNode = t.importDeclaration([t.importDefaultSpecifier(t.identifier('Taro'))], t.stringLiteral('@tarojs/taro-h5'));
                            node.body.unshift(importTaroNode);
                        }
                    }
                }
            }
        };
        const pageVisitor = {
            ClassProperty: {
                enter(astPath) {
                    const node = astPath.node;
                    const key = astConvert_1.convertAstExpressionToVariable(node.key);
                    if (key === 'config') {
                        pageConfig = astConvert_1.convertAstExpressionToVariable(node.value);
                    }
                }
            },
            ClassMethod: {
                exit(astPath) {
                    const node = astPath.node;
                    const key = node.key;
                    const keyName = astConvert_1.convertAstExpressionToVariable(key);
                    if (keyName === 'componentDidMount') {
                        componentDidMountNode = node;
                    }
                    else if (keyName === 'componentDidShow') {
                        componentDidShowNode = node;
                    }
                    else if (keyName === 'componentDidHide') {
                        componentDidHideNode = node;
                    }
                    else if (keyName === 'onPageScroll') {
                        hasOnPageScroll = true;
                    }
                    else if (keyName === 'onReachBottom') {
                        hasOnReachBottom = true;
                    }
                    else if (keyName === 'onPullDownRefresh') {
                        hasOnPullDownRefresh = true;
                    }
                    else if (keyName === 'render') {
                        renderReturnStatementPaths.length = 0;
                        renderClassMethodNode = node;
                        astPath.traverse({
                            ReturnStatement: {
                                exit(returnAstPath) {
                                    renderReturnStatementPaths.push(returnAstPath);
                                }
                            }
                        });
                    }
                }
            },
            ClassBody: {
                exit(astPath) {
                    const node = astPath.node;
                    if (!componentDidMountNode) {
                        componentDidMountNode = t.classMethod('method', t.identifier('componentDidMount'), [], t.blockStatement([
                            astConvert_1.convertSourceStringToAstExpression('super.componentDidMount && super.componentDidMount()')
                        ]), false, false);
                        node.body.push(componentDidMountNode);
                    }
                    if (!componentDidShowNode) {
                        componentDidShowNode = t.classMethod('method', t.identifier('componentDidShow'), [], t.blockStatement([
                            astConvert_1.convertSourceStringToAstExpression('super.componentDidShow && super.componentDidShow()')
                        ]), false, false);
                        node.body.push(componentDidShowNode);
                    }
                    if (!componentDidHideNode) {
                        componentDidHideNode = t.classMethod('method', t.identifier('componentDidHide'), [], t.blockStatement([
                            astConvert_1.convertSourceStringToAstExpression('super.componentDidHide && super.componentDidHide()')
                        ]), false, false);
                        node.body.push(componentDidHideNode);
                    }
                    if (hasOnReachBottom) {
                        componentDidShowNode.body.body.push(astConvert_1.convertSourceStringToAstExpression(`
                this._offReachBottom = Taro.onReachBottom({
                  callback: this.onReachBottom,
                  ctx: this,
                  onReachBottomDistance: ${JSON.stringify(pageConfig.onReachBottomDistance)}
                })
              `));
                        componentDidHideNode.body.body.push(astConvert_1.convertSourceStringToAstExpression('this._offReachBottom && this._offReachBottom()'));
                    }
                    if (hasOnPageScroll) {
                        componentDidShowNode.body.body.push(astConvert_1.convertSourceStringToAstExpression('this._offPageScroll = Taro.onPageScroll({ callback: this.onPageScroll, ctx: this })'));
                        componentDidHideNode.body.body.push(astConvert_1.convertSourceStringToAstExpression('this._offPageScroll && this._offPageScroll()'));
                    }
                    if (hasOnPullDownRefresh) {
                        componentDidShowNode.body.body.push(astConvert_1.convertSourceStringToAstExpression(`
                this.pullDownRefreshRef && this.pullDownRefreshRef.bindEvent()
              `));
                        componentDidHideNode.body.body.push(astConvert_1.convertSourceStringToAstExpression(`
                this.pullDownRefreshRef && this.pullDownRefreshRef.unbindEvent()
              `));
                    }
                }
            },
            Program: {
                exit(astPath) {
                    if (hasOnPullDownRefresh) {
                        // 增加PullDownRefresh组件
                        if (!importTaroComponentNode) {
                            importTaroComponentNode = t.importDeclaration([], t.stringLiteral('@tarojs/components'));
                            astPath.node.body.unshift(importTaroComponentNode);
                        }
                        const specifiers = importTaroComponentNode.specifiers;
                        const pos = importTaroComponentNode.specifiers.findIndex(specifier => {
                            if (!t.isImportSpecifier(specifier))
                                return false;
                            const importedComponent = astConvert_1.convertAstExpressionToVariable(specifier.imported);
                            return importedComponent === 'PullDownRefresh';
                        });
                        if (pos === -1) {
                            specifiers.push(t.importSpecifier(t.identifier('PullDownRefresh'), t.identifier('PullDownRefresh')));
                        }
                        const returnStatement = renderReturnStatementPaths.filter(renderReturnStatementPath => {
                            const funcParentPath = renderReturnStatementPath.getFunctionParent();
                            return funcParentPath.node === renderClassMethodNode;
                        });
                        returnStatement.forEach(returnAstPath => {
                            const statement = returnAstPath.node;
                            const varName = returnAstPath.scope.generateUid();
                            const returnValue = statement.argument;
                            const pullDownRefreshNode = t.variableDeclaration('const', [t.variableDeclarator(t.identifier(varName), returnValue)]);
                            returnAstPath.insertBefore(pullDownRefreshNode);
                            statement.argument = astConvert_1.convertSourceStringToAstExpression(`
                <PullDownRefresh
                  onRefresh={this.onPullDownRefresh && this.onPullDownRefresh.bind(this)}
                  ref={ref => {
                    if (ref) this.pullDownRefreshRef = ref
                }}>{${varName}}</PullDownRefresh>`).expression;
                        });
                    }
                }
            }
        };
        const visitor = util_1.mergeVisitors({}, defaultVisitor, isPage ? pageVisitor : {});
        babel_traverse_1.default(ast, visitor);
        const generateCode = better_babel_generator_1.default(ast, {
            jsescOption: {
                minimal: true
            }
        }).code;
        return {
            code: generateCode,
            ast
        };
    }
    processFiles(filePath) {
        const sourceRoot = this.sourceRoot;
        const tempDir = this.tempDir;
        const file = fs.readFileSync(filePath);
        const dirname = path.dirname(filePath);
        const extname = path.extname(filePath);
        const distDirname = dirname.replace(sourceRoot, tempDir);
        const isScriptFile = constants_1.REG_SCRIPTS.test(extname);
        const distPath = this.getDist(filePath, isScriptFile);
        try {
            if (isScriptFile) {
                // 脚本文件 处理一下
                const fileType = this.classifyFiles(filePath);
                const content = file.toString();
                let transformResult;
                if (fileType === constants_2.FILE_TYPE.ENTRY) {
                    this.pages = [];
                    transformResult = this.processEntry(content, filePath);
                }
                else {
                    transformResult = this.processOthers(content, filePath, fileType);
                }
                const jsCode = transformResult.code;
                fs.ensureDirSync(distDirname);
                fs.writeFileSync(distPath, Buffer.from(jsCode));
            }
            else {
                // 其他 直接复制
                fs.ensureDirSync(distDirname);
                fs.copySync(filePath, distPath);
            }
        }
        catch (e) {
            console.log(e);
        }
    }
    getDist(filename, isScriptFile) {
        const sourceRoot = this.sourceRoot;
        const tempDir = this.tempDir;
        const dirname = path.dirname(filename);
        const distDirname = dirname.replace(sourceRoot, tempDir);
        return isScriptFile
            ? path.format({
                dir: distDirname,
                ext: '.js',
                name: path.basename(filename, path.extname(filename))
            })
            : path.format({
                dir: distDirname,
                base: path.basename(filename)
            });
    }
}
exports.Compiler = Compiler;
function build(appPath, buildConfig) {
    return __awaiter(this, void 0, void 0, function* () {
        const compiler = new Compiler(appPath);
        //wv-edit 单独对h5的temp进行打包
        if (process.env.TARO_ENV === 'h5') {
            yield compiler.clean();
            yield compiler.buildTemp();
        }
        process.env.TARO_ENV = "h5" /* H5 */;
        yield compiler.buildDist(buildConfig);
        if (buildConfig.watch) {
            compiler.watchFiles();
        }
    });
}
exports.build = build;

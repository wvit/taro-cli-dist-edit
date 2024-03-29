"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const fs = require("fs-extra");
const chalk_1 = require("chalk");
const _ = require("lodash");
const Util = require("./util");
const config_1 = require("./config");
const constants_1 = require("./util/constants");
function build(appPath, buildConfig) {
    const { type, watch, platform, port, release } = buildConfig;
    const configDir = require(path.join(appPath, constants_1.PROJECT_CONFIG))(_.merge);
    const outputPath = path.join(appPath, configDir.outputRoot || config_1.default.OUTPUT_DIR);
    if (!fs.existsSync(outputPath)) {
        fs.ensureDirSync(outputPath);
    }
    else if (type !== "h5" /* H5 */ && (type !== "quickapp" /* QUICKAPP */ || !watch)) {
        Util.emptyDirectory(outputPath);
    }
    switch (type) {
        case "h5-temp" /*wv-edit 只对h5的.temp进行打包 */:
            buildForH5(appPath, { watch, port });
            break;
        case "h5" /* H5 */:
            buildForH5(appPath, { watch, port });
            break;
        case "weapp" /* WEAPP */:
            buildForWeapp(appPath, { watch });
            break;
        case "swan" /* SWAN */:
            buildForSwan(appPath, { watch });
            break;
        case "alipay" /* ALIPAY */:
            buildForAlipay(appPath, { watch });
            break;
        case "tt" /* TT */:
            buildForTt(appPath, { watch });
            break;
        case "rn" /* RN */:
            buildForRN(appPath, { watch });
            break;
        case "quickapp" /* QUICKAPP */:
            buildForQuickApp(appPath, { watch, port, release });
            break;
        case "qq" /* QQ */:
            //wv-edit
            //同样的写法 qq小程序打包canvas宽度获取不到，微信没问题，
            //注册usingComponents时路径获取不到node_modules下的组件，微信没问题
            //经过测试微信小程序代码可在qq小程序中运行，所以采用微信小程序的打包方式,但是环境变量还是设置为‘qq’
            // buildForQQ(appPath, { watch });
            buildForWeapp(appPath, { watch, TARO_ENV: 'qq' });
            break;
        case "ui" /* UI */:
            buildForUILibrary(appPath, { watch });
            break;
        case "plugin" /* PLUGIN */:
            buildForPlugin(appPath, {
                watch,
                platform
            });
            break;
        default:
            console.log(chalk_1.default.red('输入类型错误，目前只支持 weapp/swan/alipay/tt/h5/quickapp/rn 七端类型'));
    }
}
exports.default = build;
function buildForWeapp(appPath, { watch, TARO_ENV }) {
    require('./mini').build(appPath, {
        watch,
        TARO_ENV,// wv-edit
        adapter: "weapp", /* WEAPP */
    });
}
function buildForSwan(appPath, { watch }) {
    require('./mini').build(appPath, {
        watch,
        adapter: "swan" /* SWAN */
    });
}
function buildForAlipay(appPath, { watch }) {
    require('./mini').build(appPath, {
        watch,
        adapter: "alipay" /* ALIPAY */
    });
}
function buildForTt(appPath, { watch }) {
    require('./mini').build(appPath, {
        watch,
        adapter: "tt" /* TT */
    });
}
function buildForH5(appPath, buildConfig) {
    require('./h5').build(appPath, buildConfig);
}
function buildForRN(appPath, { watch }) {
    require('./rn').build(appPath, { watch });
}
function buildForQuickApp(appPath, { watch, port, release }) {
    require('./mini').build(appPath, {
        watch,
        adapter: "quickapp" /* QUICKAPP */,
        port,
        release
    });
}
function buildForQQ(appPath, { watch }) {
    require('./mini').build(appPath, {
        watch,
        adapter: "qq" /* QQ */
    });
}
function buildForUILibrary(appPath, { watch }) {
    require('./ui').build(appPath, { watch });
}
function buildForPlugin(appPath, { watch, platform }) {
    const typeMap = {
        ["weapp" /* WEAPP */]: '微信',
        ["alipay" /* ALIPAY */]: '支付宝'
    };
    if (platform !== "weapp" /* WEAPP */ && platform !== "alipay" /* ALIPAY */) {
        console.log(chalk_1.default.red('目前插件编译仅支持 微信/支付宝 小程序！'));
        return;
    }
    console.log(chalk_1.default.green(`开始编译${typeMap[platform]}小程序插件`));
    require('./plugin').build(appPath, { watch, platform });
}

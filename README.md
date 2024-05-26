# MLN-Debugger
MLN-Debugger 的作用是可以在使用vscode调试开源项目框架[MLN](https://github.com/momotech/MLN)，并不支持原始版本，需要使用经过我修改的[MLN-lite](https://github.com/lizhizhuanshu/MLNlite)

## 配置说明
* sourceDir  源代码目录 例如 src
* port 热重载监听的端口 默认 8176
* entryFile 入口文件 默认 index.lua
以上配置既可以是通用配置也可以是调试器配置

## 开发
需要注意的是，有些文件是由[generated_proto.sh](generated_proto.sh)脚本生成的，所以在执行完```npm init```后需要调用此脚本

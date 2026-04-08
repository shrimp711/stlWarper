# STLwarp Frontend Tool

STLwarp 已重构为纯前端网页工具，目标流程如下：

1. 上传 STL
2. 选择材料与工艺预设
3. 自动变形补偿
4. 自动下载补偿后 STL

## 特性

- 纯前端运行，不依赖后端服务，不上传模型数据。
- 预设材料工艺库，读取 material-db/database.json。
- 3D 预览，同屏显示原始模型与补偿后模型。
- 一键导出，补偿完成后自动下载 STL。

## 目录结构

- index.html: 页面入口。
- style.css: 页面样式。
- js/app.js: 页面交互与流程控制。
- js/compensator.js: 前端补偿算法与数据库索引。
- js/viewer.js: Three.js 预览。
- material-db/database.json: 固有形变数据库。

## 本地运行

建议使用静态服务器打开，避免浏览器 file 协议下拦截 JSON 请求。

PowerShell 示例：

```powershell
Set-Location D:/Document/3Dprinting/Bumpmesh/stlWarper
python -m http.server 5173
```

然后在浏览器访问：

http://localhost:5173

## 说明

- 补偿算法基于固有形变库的轻量几何代理模型，适合快速预补偿与工艺对比。
- 如果需要更高物理精度，可在后续版本接入更高保真求解器或实验标定曲线。

export const TASK_NAMES = {navigate: '打开网页', waitFor: '等待元素', click: '点击元素', fill: '填入文本', press: '按下按键', scroll: '滚动页面', wait: '等待片刻', screenshot: '保存截图'};
export function freshStep(type = 'navigate') { return {type, url: '', selector: '', text: '', key: 'Enter', duration: 1000, x: 0, y: 500, timeout: 15000}; }

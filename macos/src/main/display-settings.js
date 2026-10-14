'use strict';

function displayMode(overrides = {}) {
  if (overrides.displayMode) return overrides.displayMode;
  return overrides.screen || overrides.devicePixelRatio !== undefined ? 'custom' : 'native';
}

function validScreen(value) {
  return value && ['width','height','availWidth','availHeight','colorDepth','pixelDepth'].every(key => Number.isFinite(value[key]) && value[key] > 0)
    && value.availWidth <= value.width && value.availHeight <= value.height;
}

function displaySnapshot(display) {
  if (!display?.size || !Number.isFinite(display.scaleFactor) || display.scaleFactor <= 0) return null;
  const {width, height} = display.size;
  const work = display.workAreaSize || display.workArea || display.size;
  const depth = display.colorDepth || 24;
  const value = {
    screen: {width, height, availWidth: work.width, availHeight: work.height, colorDepth: depth, pixelDepth: depth},
    devicePixelRatio: display.scaleFactor,
  };
  return validScreen(value.screen) ? value : null;
}

const nativeDisplaySource = `({screen:{width:screen.width,height:screen.height,availWidth:screen.availWidth,availHeight:screen.availHeight,colorDepth:screen.colorDepth,pixelDepth:screen.pixelDepth},devicePixelRatio})`;

async function captureDisplay(send, fp, zoom = 1) {
  if (fp.displayMode !== 'native') return;
  const response = await send('Runtime.evaluate', {expression: nativeDisplaySource, returnByValue: true});
  const value = response.result?.value;
  if (response.exceptionDetails || !value || !validScreen(value.screen) || !Number.isFinite(value.devicePixelRatio) || value.devicePixelRatio <= 0 || !Number.isFinite(zoom) || zoom <= 0) {
    throw new Error('无法读取浏览器原生显示参数');
  }
  fp.screen = value.screen;
  fp.devicePixelRatio = value.devicePixelRatio / zoom;
  fp.nativeDisplayPending = false;
}

module.exports = {displayMode, displaySnapshot, captureDisplay, nativeDisplaySource};

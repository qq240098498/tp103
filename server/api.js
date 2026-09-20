// 对外的动作集合：页面只经过这一层，规则、规则集、文件与扫描几块各自管好自己的校验
const { ApiError, pickText } = require('./errors');
const rules = require('./rules');
const ruleSets = require('./ruleSets');
const files = require('./files');
const { scan } = require('./scan');

// 查询参数在页面与接口之间来回传的都是文本，这里统一去掉首尾空白并兜住空值
function readQuery(query, name) {
  return pickText(query && query[name]);
}

// 当前操作者由请求头 X-Operator 带上（页面用百分号编码成纯 ASCII，避免中文头被按 latin1 读花）；
// 写操作缺了它会在规则模块里被 401 拦下
function readOperator(req) {
  const raw = req && req.headers ? pickText(req.headers['x-operator']) : '';
  if (!raw) return '';
  // 兼容直接发 UTF-8 字节的客户端：先把 latin1 的误读修回 UTF-8，再解百分号编码
  const repaired = Buffer.from(raw, 'latin1').toString('utf8');
  if (!repaired.includes('%')) return repaired;
  try {
    return decodeURIComponent(repaired);
  } catch (err) {
    return repaired;
  }
}

module.exports = {
  ApiError,
  readQuery,
  readOperator,
  scan,
  ...ruleSets,
  ...rules,
  ...files,
};

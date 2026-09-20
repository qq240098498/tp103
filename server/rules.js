const crypto = require('crypto');
const { load, save, LEVELS, STATUSES, FILE_TYPES, MAX_CODE_LENGTH, MAX_RULE_NAME_LENGTH, MAX_PATTERN_LENGTH, MAX_NOTE_LENGTH } = require('./store');
const { ApiError, pickText } = require('./errors');
const {
  requireOperator,
  makePermission,
  assertRuleWritable,
  assertSetWritableForCreate,
} = require('./ruleSets');

// 规则编码固定成大写字母加分段的数字，方便在命中清单里引用
const CODE_PATTERN = /^[A-Z]{2,6}-\d{2,4}$/;

function validateCode(value, data, selfId) {
  const code = pickText(value);
  if (!code) throw new ApiError(400, 'CODE_REQUIRED', '请填写规则编码', 'code');
  if (code.length > MAX_CODE_LENGTH) {
    throw new ApiError(400, 'CODE_TOO_LONG', `规则编码不能超过 ${MAX_CODE_LENGTH} 个字符`, 'code');
  }
  if (!CODE_PATTERN.test(code)) {
    throw new ApiError(400, 'CODE_INVALID', '规则编码要写成大写字母加短横线加数字，例如 CODE-001', 'code');
  }
  const hit = data.rules.find((item) => item.id !== selfId && item.code.toLowerCase() === code.toLowerCase());
  if (hit) throw new ApiError(409, 'CODE_DUPLICATED', `编码 ${hit.code} 已经被 ${hit.name} 用了`, 'code');
  return code;
}

function validateName(value) {
  const name = pickText(value);
  if (!name) throw new ApiError(400, 'NAME_REQUIRED', '请填写规则名称', 'name');
  if (name.length > MAX_RULE_NAME_LENGTH) {
    throw new ApiError(400, 'NAME_TOO_LONG', `规则名称不能超过 ${MAX_RULE_NAME_LENGTH} 个字符`, 'name');
  }
  return name;
}

function validatePattern(value) {
  const pattern = typeof value === 'string' ? value : '';
  if (!pattern.trim()) throw new ApiError(400, 'PATTERN_REQUIRED', '请填写要匹配的写法', 'pattern');
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new ApiError(400, 'PATTERN_TOO_LONG', `匹配写法不能超过 ${MAX_PATTERN_LENGTH} 个字符`, 'pattern');
  }
  return pattern;
}

function validateLevel(value) {
  const level = pickText(value);
  if (!level) return LEVELS[0];
  if (!LEVELS.includes(level)) {
    throw new ApiError(400, 'LEVEL_INVALID', `级别只能是 ${LEVELS.join('、')} 其中之一`, 'level');
  }
  return level;
}

function validateStatus(value) {
  const status = pickText(value);
  if (!status) return STATUSES[0];
  if (!STATUSES.includes(status)) {
    throw new ApiError(400, 'STATUS_INVALID', `状态只能是 ${STATUSES.join('、')} 其中之一`, 'status');
  }
  return status;
}

function validateFileType(value) {
  const fileType = pickText(value);
  if (!fileType) return FILE_TYPES[0];
  if (!FILE_TYPES.includes(fileType)) {
    throw new ApiError(400, 'FILE_TYPE_INVALID', `适用文件类型只能是 ${FILE_TYPES.join('、')} 其中之一`, 'fileType');
  }
  return fileType;
}

function validateNote(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ApiError(400, 'NOTE_INVALID', '说明需要是文本', 'note');
  if (value.length > MAX_NOTE_LENGTH) {
    throw new ApiError(400, 'NOTE_TOO_LONG', `说明不能超过 ${MAX_NOTE_LENGTH} 个字符`, 'note');
  }
  return value.trim();
}

function sortRules(list) {
  return list.slice().sort((a, b) => {
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

// 规则清单：按级别、状态、适用文件类型筛选，再按编码、名称或匹配写法搜索；
// 带上 operator 时给每条规则标出当前操作者能不能改，别人管的与无归属的照常列出但只读
function listRules(options) {
  const input = options && typeof options === 'object' ? options : {};
  const level = pickText(input.level);
  const status = pickText(input.status);
  const fileType = pickText(input.fileType);
  const keyword = pickText(input.keyword).toLowerCase();
  const operator = pickText(input.operator);
  const data = load();

  const setMap = new Map(data.ruleSets.map((item) => [item.id, item]));
  const permission = operator ? makePermission(data, operator) : null;

  let list = data.rules;
  if (level) list = list.filter((item) => item.level === level);
  if (status) list = list.filter((item) => item.status === status);
  if (fileType) list = list.filter((item) => item.fileType === fileType || item.fileType === '全部');
  if (keyword) {
    list = list.filter((item) => item.code.toLowerCase().includes(keyword)
      || item.name.toLowerCase().includes(keyword)
      || item.pattern.toLowerCase().includes(keyword));
  }

  const withScope = (rule) => {
    const ruleSet = rule.ruleSetId ? setMap.get(rule.ruleSetId) : null;
    return {
      ...rule,
      ruleSetName: ruleSet ? ruleSet.name : '',
      owners: ruleSet ? ruleSet.owners.slice() : [],
      editable: permission ? permission.canEdit(rule) : false,
    };
  };

  const sorted = sortRules(list).map(withScope);
  const editableCount = permission ? sorted.filter((item) => item.editable).length : 0;
  const usedFileTypes = Array.from(new Set(data.rules.map((item) => item.fileType)));
  return {
    rules: sorted,
    levels: LEVELS.slice(),
    statuses: STATUSES.slice(),
    fileTypes: FILE_TYPES.slice(),
    usedFileTypes,
    operator,
    editableCount,
    readonlyCount: sorted.length - editableCount,
  };
}

function getRule(id, operator) {
  const data = load();
  const found = data.rules.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'RULE_NOT_FOUND', '这条规则不存在或已被删除', '');
  const ruleSet = found.ruleSetId ? data.ruleSets.find((item) => item.id === found.ruleSetId) : null;
  const viewer = pickText(operator);
  const editable = Boolean(ruleSet && viewer && ruleSet.owners.includes(viewer));
  return {
    ...found,
    ruleSetName: ruleSet ? ruleSet.name : '',
    owners: ruleSet ? ruleSet.owners.slice() : [],
    editable,
  };
}

function createRule(payload, operator) {
  // 先验身份与归属范围，任何一项不过都在落盘之前拦下
  const actor = requireOperator(operator);
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const ruleSetId = pickText(input.ruleSetId);
  assertSetWritableForCreate(data, actor, ruleSetId);

  const now = new Date().toISOString();
  const created = {
    id: crypto.randomUUID(),
    ruleSetId,
    code: validateCode(input.code, data, ''),
    name: validateName(input.name),
    level: validateLevel(input.level),
    status: validateStatus(input.status),
    fileType: validateFileType(input.fileType),
    pattern: validatePattern(input.pattern),
    note: validateNote(input.note),
    createdAt: now,
    updatedAt: now,
  };
  data.rules.push(created);
  save(data);
  return created;
}

function updateRule(id, payload, operator) {
  const actor = requireOperator(operator);
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const found = data.rules.find((item) => item.id === id);
  if (!found) throw new ApiError(404, 'RULE_NOT_FOUND', '这条规则不存在或已被删除', '');
  // 越权在这里当场拦下：还没改任何字段，更不会落盘
  assertRuleWritable(data, actor, found);
  // 归属不允许通过编辑挪到别的规则集，避免借编辑把别人的规则换个归属
  if (input.ruleSetId !== undefined && pickText(input.ruleSetId) !== found.ruleSetId) {
    throw new ApiError(403, 'RULE_SET_LOCKED', '规则的归属规则集不能通过编辑修改', 'ruleSetId');
  }

  found.code = input.code === undefined ? found.code : validateCode(input.code, data, found.id);
  found.name = input.name === undefined ? found.name : validateName(input.name);
  found.level = input.level === undefined ? found.level : validateLevel(input.level);
  found.status = input.status === undefined ? found.status : validateStatus(input.status);
  found.fileType = input.fileType === undefined ? found.fileType : validateFileType(input.fileType);
  found.pattern = input.pattern === undefined ? found.pattern : validatePattern(input.pattern);
  found.note = input.note === undefined ? found.note : validateNote(input.note);
  found.updatedAt = new Date().toISOString();
  save(data);
  return found;
}

function deleteRule(id, operator) {
  const actor = requireOperator(operator);
  const data = load();
  const index = data.rules.findIndex((item) => item.id === id);
  if (index === -1) throw new ApiError(404, 'RULE_NOT_FOUND', '这条规则不存在或已被删除', '');
  assertRuleWritable(data, actor, data.rules[index]);
  const [removed] = data.rules.splice(index, 1);
  save(data);
  return { id: removed.id, code: removed.code, name: removed.name };
}

module.exports = {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
};

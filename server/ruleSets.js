// 规则集：每个规则集归一个人或一组人管。页面先选人，规则区只放开他名下规则集里的规则
const { load, MAX_OWNER_NAME_LENGTH } = require('./store');
const { ApiError, pickText } = require('./errors');

// 写操作都要先报上当前操作者：没选（或发空）一律 401，不能匿名改
function requireOperator(value) {
  const operator = pickText(value);
  if (!operator) {
    throw new ApiError(401, 'OPERATOR_REQUIRED', '请先在页面右上角选择当前是谁在看，再改动规则', 'operator');
  }
  if (operator.length > MAX_OWNER_NAME_LENGTH) {
    throw new ApiError(400, 'OPERATOR_INVALID', `操作者姓名不能超过 ${MAX_OWNER_NAME_LENGTH} 个字符`, 'operator');
  }
  return operator;
}

// 某个操作者管哪些规则集：一个人同时出现在多个规则集的负责人名单里时，范围自动叠加
function setsManagedBy(data, operator) {
  return data.ruleSets.filter((item) => item.owners.includes(operator));
}

// 生成当前操作者的可改范围：名下所有规则集取并集，一条规则在不在并集里决定能不能改
function makePermission(data, operator) {
  const editableSetIds = new Set(setsManagedBy(data, operator).map((item) => item.id));
  return {
    editableSetIds,
    // 一条规则不属于任何规则集（或所属规则集已不存在）时谁都不能改
    canEdit(rule) {
      return Boolean(rule.ruleSetId && editableSetIds.has(rule.ruleSetId));
    },
    // 新建时目标规则集必须存在；不选规则集等同于把规则建成谁都不能改，写操作直接拦下
    canCreate(ruleSetId) {
      return Boolean(ruleSetId && editableSetIds.has(ruleSetId));
    },
  };
}

// 新建/修改/删除前当场校验：越权一律在落盘之前抛 403，并写清这条规则归谁管
function assertRuleWritable(data, operator, rule) {
  const targetSet = rule.ruleSetId
    ? data.ruleSets.find((item) => item.id === rule.ruleSetId)
    : null;
  if (!rule.ruleSetId || !targetSet) {
    throw new ApiError(403, 'RULE_UNOWNED_READONLY',
      `规则 ${rule.code} 不属于任何规则集，谁都不能改，只能看`, 'ruleSetId');
  }
  if (!targetSet.owners.includes(operator)) {
    throw new ApiError(403, 'RULE_FORBIDDEN',
      `规则 ${rule.code} 属于「${targetSet.name}」，由 ${targetSet.owners.join('、')} 负责，${operator} 只能看不能改`,
      'ruleSetId');
  }
}

// 新建时单独校验目标规则集：必须选中当前操作者名下的规则集
function assertSetWritableForCreate(data, operator, ruleSetId) {
  if (!ruleSetId) {
    throw new ApiError(403, 'RULE_SET_REQUIRED',
      '新规则必须归到一个规则集；不属于任何规则集的规则谁都不能改，只能看', 'ruleSetId');
  }
  const targetSet = data.ruleSets.find((item) => item.id === ruleSetId);
  if (!targetSet) {
    throw new ApiError(400, 'RULE_SET_NOT_FOUND', '选中的规则集不存在', 'ruleSetId');
  }
  if (!targetSet.owners.includes(operator)) {
    throw new ApiError(403, 'RULE_SET_FORBIDDEN',
      `「${targetSet.name}」由 ${targetSet.owners.join('、')} 负责，${operator} 不能往里面加规则`,
      'ruleSetId');
  }
}

// 规则集清单：附上负责人名单，以及按负责人汇总的可改范围；页面顶栏的下拉与只读判定都用它
function listRuleSets() {
  const data = load();
  const counts = new Map();
  data.ruleSets.forEach((item) => counts.set(item.id, 0));
  data.rules.forEach((rule) => {
    if (rule.ruleSetId && counts.has(rule.ruleSetId)) {
      counts.set(rule.ruleSetId, counts.get(rule.ruleSetId) + 1);
    }
  });
  const ruleSets = data.ruleSets.map((item) => ({
    ...item,
    ruleCount: counts.get(item.id) || 0,
  }));

  // 人员清单：取所有规则集负责人的并集，附上每人管的规则集；赵启这类一人管多集的天然叠加
  const peopleMap = new Map();
  ruleSets.forEach((item) => {
    item.owners.forEach((name) => {
      if (!peopleMap.has(name)) peopleMap.set(name, { name, setIds: [], setNames: [] });
      const person = peopleMap.get(name);
      person.setIds.push(item.id);
      person.setNames.push(item.name);
    });
  });
  const people = Array.from(peopleMap.values())
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  return {
    ruleSets,
    people,
    unownedCount: data.rules.filter((rule) => !rule.ruleSetId).length,
  };
}

module.exports = {
  listRuleSets,
  requireOperator,
  setsManagedBy,
  makePermission,
  assertRuleWritable,
  assertSetWritableForCreate,
};

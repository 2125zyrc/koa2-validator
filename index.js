const validator = require("validator")
const { get, last, set, cloneDeep } = require("lodash")

class Koa2Validator {
  constructor() {
    this.data = {}
    this.parsed = {}
  }

  _assembleAllParams(ctx) {
    return {
      body: ctx.request.body,
      query: ctx.request.query,
      path: ctx.params,
      header: ctx.request.header
    }
  }

   _findMembers (instance, { prefix, specifiedType, filter }) {
    // 递归函数
    function _find(instance) {
      //基线条件（跳出递归）
      if (instance.__proto__ === null) return []
  
      let names = Reflect.ownKeys(instance)
      names = names.filter(name => {
        // 过滤掉不满足条件的属性或方法名
        return _shouldKeep(name)
      })
  
      return [...names, ..._find(instance.__proto__)]
    }
  
    function _shouldKeep(value) {
      if (filter) {
        if (filter(value)) {
          return true
        }
      }
      if (prefix) if (value.startsWith(prefix)) return true
      if (specifiedType) if (instance[value] instanceof specifiedType) return true
    }
  
    return _find(instance)
  }

  get(path, parsed = true) {
    if (parsed) {
      const value = get(this.parsed, path, null)
      if (value == null) {
        const keys = path.split(".")
        const key = last(keys)
        return get(this.parsed.default, key)
      }
      return value
    } else {
      return get(this.data, path)
    }
  }

  getErrors(isOne=false){
    if(!this.errors ) return []
    if(isOne){
      return this.errors[0]
    }
    return this.errors
  }

  _findMembersFilter(key) {
    if (/validate([A-Z])\w+/g.test(key)) {
      return true
    }
    if (this[key] instanceof Array) {
      this[key].forEach(value => {
        const isRuleType = value instanceof Rule
        if (!isRuleType) {
          throw new Error("验证数组必须全部为Rule类型")
        }
      })
      return true
    }
    return false
  }

  async validate(ctx, alias = {}) {
    this.alias = alias
    let params = this._assembleAllParams(ctx)
    this.data = cloneDeep(params)
    this.parsed = cloneDeep(params)

    const memberKeys = this._findMembers(this, {
      filter: this._findMembersFilter.bind(this),
    })
    
    const errorMsgs = []
    // const map = new Map(memberKeys)
    for (let key of memberKeys) {
      const result = await this._check(key, alias)
      if (!result.success) {
        errorMsgs.push(result.msg)
      }
    }
    this.errors = errorMsgs
    if (errorMsgs.length != 0) {
      return false
    }
    return true
  }

  async _check(key, alias = {}) {
    const isCustomFunc = typeof this[key] == "function" ? true : false
    let result
    if (isCustomFunc) {
      try {
        // console.log(this[key])
        const customRes =  await this[key](this.data)
        if(customRes === true){
          result = new RuleResult(true)
        }else{
          result = new RuleResult(false, customRes)
        }
      } catch (error) {
        result = new RuleResult(false, error.msg || error.message || "参数错误")
      }
      // 函数验证
    } else {
      // 属性验证, 数组，内有一组Rule
      const rules = this[key]
      const ruleField = new RuleField(rules)
      // 别名替换
      key = alias[key] ? alias[key] : key
      const param = this._findParam(key)

      result = ruleField.validate(param.value)

      if (result.pass) {
        // 如果参数路径不存在，往往是因为用户传了空值，而又设置了默认值
        if (param.path.length == 0) {
          set(this.parsed, ["default", key], result.legalValue)
        } else {
          set(this.parsed, param.path, result.legalValue)
        }
      }
    }
    if (!result.pass) {
      const msg = `${isCustomFunc ? "" : key}${result.msg}`
      return {
        msg: msg,
        success: false
      }
    }
    return {
      msg: "ok",
      success: true
    }
  }

  _findParam(key) {
    let value
    value = get(this.data, ["query", key])
    if (value) {
      return {
        value,
        path: ["query", key]
      }
    }
    value = get(this.data, ["body", key])
    if (value) {
      return {
        value,
        path: ["body", key]
      }
    }
    value = get(this.data, ["path", key])
    if (value) {
      return {
        value,
        path: ["path", key]
      }
    }
    value = get(this.data, ["header", key])
    if (value) {
      return {
        value,
        path: ["header", key]
      }
    }
    return {
      value: null,
      path: []
    }
  }
}

class RuleResult {
  constructor(pass, msg = "") {
    Object.assign(this, {
      pass,
      msg
    })
  }
}

class RuleFieldResult extends RuleResult {
  constructor(pass, msg = "", legalValue = null) {
    super(pass, msg)
    this.legalValue = legalValue
  }
}

class Rule {
  constructor(name, msg, ...params) {
    Object.assign(this, {
      name,
      msg,
      params
    })
  }

  validate(field) {
    if (this.name == "isOptional") return new RuleResult(true)
    if (!validator[this.name](field + "", ...this.params)) {
      return new RuleResult(false, this.msg || this.message || "参数错误")
    }
    return new RuleResult(true, "")
  }
}

class RuleField {
  constructor(rules) {
    this.rules = rules
  }

  validate(field) {
    if (field == null) {
      // 如果字段为空
      const allowEmpty = this._allowEmpty()
      const defaultValue = this._hasDefault()
      if (allowEmpty) {
        return new RuleFieldResult(true, "", defaultValue)
      } else {
        return new RuleFieldResult(false, "字段是必填参数")
      }
    }

    const filedResult = new RuleFieldResult(false)
    for (let rule of this.rules) {
      let result = rule.validate(field)
      if (!result.pass) {
        filedResult.msg = result.msg
        filedResult.legalValue = null
        // 一旦一条校验规则不通过，则立即终止这个字段的验证
        return filedResult
      }
    }
    return new RuleFieldResult(true, "", this._convert(field))
  }

  _convert(value) {
    for (let rule of this.rules) {
      if (rule.name == "isInt") {
        return parseInt(value)
      }
      if (rule.name == "isFloat") {
        return parseFloat(value)
      }
      if (rule.name == "isBoolean") {
        return value ? true : false
      }
    }
    return value
  }

  _allowEmpty() {
    for (let rule of this.rules) {
      if (rule.name == "isOptional") {
        return true
      }
    }
    return false
  }

  _hasDefault() {
    for (let rule of this.rules) {
      const defaultValue = rule.params[0]
      if (rule.name == "isOptional") {
        return defaultValue
      }
    }
  }
}
module.exports = {
  Rule,
  Koa2Validator
}
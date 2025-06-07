#### 使用
```
npm install koa2-validator
```

#### 如何定义一个UserValidator验证器类  
```
const { Rule, Koa2Validator } = require('koa2-vlidator')

class UserValidator extends Koa2Validator{
  constructor(){
    super()
    this.name = [
      new Rule('isEmail','邮箱不正确')
    ]
    this.passWd = [
      new Rule('isLength', '密码至少6个字符,最多32个字符', {
        min: 6,
        max: 32
      }),
    ]
  }
  //自定义验证规则 错误返回错误信息 正确返回true
  validateLoginType(vals){
    return  vals.query.name !== '111' ? '用户账号已经存在' : true 
  }
}

module.exports = {
  UserValidator
}

```

#### 如何调用
```
router.get('/user',async (ctx,next)=>{
  const userValidator =  new UserValidator()
  const check = await userValidator.validate(ctx)
  if(!check){
    console.log(userValidator.get('query.name'))
    console.log(userValidator.getErrors())
  }
})

```
#### 该插件以validator为基础，特别感谢 [TaleLin](https://github.com/TaleLin)  
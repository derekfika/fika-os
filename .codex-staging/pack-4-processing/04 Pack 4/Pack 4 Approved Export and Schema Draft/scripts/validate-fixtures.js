const fs=require('fs'); const path=require('path');
function check(schema, obj, p=''){
  let errors=[];
  if(schema.type==='object'){
    if(obj===null || Array.isArray(obj) || typeof obj!=='object') return [`${p||'/'}: expected object`];
    for(const r of (schema.required||[])) if(!(r in obj)) errors.push(`${p}/${r}: required property missing`);
    if(schema.additionalProperties===false){ for(const k of Object.keys(obj)) if(!schema.properties || !(k in schema.properties)) errors.push(`${p}/${k}: additional property not allowed`); }
    for(const [k,v] of Object.entries(obj)) if(schema.properties && schema.properties[k]) errors=errors.concat(check(schema.properties[k], v, `${p}/${k}`));
  } else if(schema.type==='array'){
    if(!Array.isArray(obj)) errors.push(`${p}: expected array`); else { if(schema.minItems && obj.length<schema.minItems) errors.push(`${p}: too few items`); obj.forEach((x,i)=>{ if(schema.items) errors=errors.concat(check(schema.items,x,`${p}/${i}`)); }); }
  } else if(schema.type==='string'){
    if(typeof obj!=='string') errors.push(`${p}: expected string`); if(schema.const!==undefined && obj!==schema.const) errors.push(`${p}: expected const ${schema.const}`); if(schema.enum && !schema.enum.includes(obj)) errors.push(`${p}: not in enum`); if(schema.minLength && obj.length<schema.minLength) errors.push(`${p}: too short`);
  } else if(schema.type==='integer'){
    if(!Number.isInteger(obj)) errors.push(`${p}: expected integer`); if(schema.minimum!==undefined && obj<schema.minimum) errors.push(`${p}: below minimum`);
  } else if(schema.type==='number'){
    if(typeof obj!=='number') errors.push(`${p}: expected number`); if(schema.exclusiveMinimum!==undefined && !(obj>schema.exclusiveMinimum)) errors.push(`${p}: not above exclusive minimum`);
  } else if(schema.type==='boolean'){
    if(typeof obj!=='boolean') errors.push(`${p}: expected boolean`); if(schema.const!==undefined && obj!==schema.const) errors.push(`${p}: expected const ${schema.const}`);
  }
  return errors;
}
const base=path.resolve(__dirname,'..','schemas'); let results=[]; let failures=0;
for(const sf of fs.readdirSync(base).filter(f=>f.endsWith('.schema.json')).sort()){
  const schema=JSON.parse(fs.readFileSync(path.join(base,sf),'utf8'));
  const stem=sf.replace('.schema.json','');
  for(const [kind, expected] of [['valid','pass'],['invalid','fail']]){
    const fp=path.join(base,'fixtures',kind,`${kind}-${stem}.json`);
    const obj=JSON.parse(fs.readFileSync(fp,'utf8'));
    const errors=check(schema,obj);
    const actual=errors.length?'fail':'pass';
    const passed=actual===expected; if(!passed) failures++;
    results.push({schema:sf, fixture:path.basename(fp), expected, actual, passed, errors});
  }
}
console.log(JSON.stringify({validator:'local structural subset validator', failures, results}, null, 2));
process.exit(failures?1:0);
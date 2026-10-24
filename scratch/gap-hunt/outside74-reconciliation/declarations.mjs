/** Inventory real test declarations with the TypeScript parser; lexical string calls are excluded. */
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const selection=JSON.parse(readFileSync(new URL('./selection.json',import.meta.url),'utf8'));
const rows=[];
function rootName(expression){
 if(ts.isIdentifier(expression))return expression.text;
 if(ts.isPropertyAccessExpression(expression))return rootName(expression.expression);
 if(ts.isCallExpression(expression))return rootName(expression.expression);
 if(ts.isTaggedTemplateExpression(expression))return rootName(expression.tag);
 return undefined;
}
for(const path of selection.selectedFiles){
 const text=readFileSync(path,'utf8');const source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,path.endsWith('.mjs')?ts.ScriptKind.JS:ts.ScriptKind.TS);
 function walk(node){
  if(ts.isCallExpression(node)&&['test','it'].includes(rootName(node.expression))){
   const title=node.arguments[0];
   if(title&&(ts.isStringLiteralLike(title)||ts.isTemplateExpression(title))){
    const location=source.getLineAndCharacterOfPosition(node.getStart(source));
    rows.push({path,line:location.line+1,titleExpression:title.getText(source),title:ts.isStringLiteralLike(title)?title.text:null,call:node.expression.getText(source),assertionSourceSha256:createHash('sha256').update(node.getText(source)).digest('hex')});
   }
  }
  ts.forEachChild(node,walk);
 }
 walk(source);
}
writeFileSync(process.argv[2],JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify({files:selection.selectedFiles.length,declarations:rows.length,parameterizedOrDynamic:rows.filter(r=>r.call.includes('each')||r.title===null).length}));

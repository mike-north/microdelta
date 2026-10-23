// Enumerate actual generated alpha declaration members with TypeScript's checker.
// Missing target semantics are assessed against these complete interfaces, not
// inferred from absence of a guessed export or method name.
import ts from 'typescript';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
const configPath=resolve('packages/core/tsconfig.json');
const config=ts.readConfigFile(configPath,ts.sys.readFile);
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,resolve('packages/core'));
const files=['packages/core/dist/api/microdelta.alpha.d.ts','packages/accounting/dist/api/accounting.alpha.d.ts'].map(p=>resolve(p));
const program=ts.createProgram(files,{...parsed.options,noEmit:true,rootDir:undefined});
const checker=program.getTypeChecker();const surfaces={};
for(const file of files){
 const source=program.getSourceFile(file);const module=checker.getSymbolAtLocation(source);
 for(const symbol of checker.getExportsOfModule(module)){
  if(!['IWorkspace','IWorkspaceRun','IWorkspaceRunOptions','IRunObserver','IWorkspaceAccounting','IDurableAccounting','IUsageReport','IUsageQuantity','IUsageEstimate','IUsageSummary'].includes(symbol.name))continue;
  const type=checker.getDeclaredTypeOfSymbol(symbol);
  surfaces[symbol.name]=checker.getPropertiesOfType(type).map(p=>({name:p.name,type:checker.typeToString(checker.getTypeOfSymbolAtLocation(p,p.valueDeclaration??p.declarations[0]))}));
 }
}
const manifests=['package.json',...readdirSync('packages').map(p=>`packages/${p}/package.json`)];
const packages=manifests.map(p=>({path:p,...JSON.parse(readFileSync(p,'utf8'))})).map(p=>({path:p.path,name:p.name,bin:p.bin??null,exports:p.exports??null}));
console.log(JSON.stringify({surfaces,packages},null,2));

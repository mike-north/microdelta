/** Observe real facade discovery SQL through Machine; storage and domain owners are unchanged. */
import { expect, jest, test } from '@jest/globals';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as adapter from '@microdelta/machine-node';
import type { ISqliteCapability, ISqliteValue } from '@microdelta/machine';

/** One completed real statement; phase names mark observed boundaries, not inferred CPU attribution. */
interface IEvent { readonly phase: string; readonly role: string; readonly method: string; readonly sql: string; readonly values: readonly ISqliteValue[]; readonly rows: number }
/** Original supported member shape; keys and scores retain separate semantics. */
interface IMember { readonly key: string; readonly score: number }
interface IListing { readonly members: readonly IMember[]; readonly status: 'complete' }
interface IInputs { readonly size: number }
const real = adapter.createNodeSqlite();
let phase = 'setup';
let events: IEvent[] = [];
const observed: ISqliteCapability = {
  openSqlite(location) {
    const connection = real.openSqlite(location);
    return {...connection, prepare(sql) {
      const statement = connection.prepare(sql);
      const role = /^\s*\/\*\s*([a-z-]+)\s*\*\//u.exec(sql)?.[1] ?? 'untagged';
      const boundary = (values: readonly ISqliteValue[]): void => {
        if (role === 'subtree-payload') { phase = 'discovery-read'; }
        if (/INSERT INTO history_attempts/u.test(sql) && typeof values[3] === 'string') { phase = values[3] === 'listing' ? 'source-attempt' : 'member-attempt'; }
      };
      const record = (method: string, values: readonly ISqliteValue[], rows: number): void => { events.push({phase,role,method,sql,values,rows}); };
      return {
        run(...values) { boundary(values); const value = statement.run(...values); record('run',values,0); return value; },
        get(...values) { boundary(values); const value = statement.get(...values); record('get',values,value === undefined ? 0 : 1); return value; },
        all(...values) { boundary(values); const value = statement.all(...values); record('all',values,value.length); return value; },
      };
    }};
  },
};
// Replace only the Node capability factory before importing the real facade; all owner code remains production code.
jest.unstable_mockModule('@microdelta/machine-node', () => ({...adapter,createNodeSqlite: () => observed}));
const {authoring,openWorkspace} = await import('microdelta');

test('10/20/40 production discovery reads retain exact outcomes with one linear returned subtree', async () => {
  const captures: unknown[] = [];
  for (const size of [10,20,40]) {
    events = []; phase = 'setup';
    let sourceBodies = 0; const bodyKeys: string[] = [];
    const api = authoring<IInputs, Record<string, never>>();
    const listing = api.source<IListing>({subject:'listing',collection:{identity:'key'},finality:() => true,run:({inputs,outcome}) => { sourceBodies += 1; return outcome.fresh<IListing>({members:Array.from({length:inputs.size},(_,index) => ({key:`member:${index}`,score:index})),status:'complete'}); }});
    const template = api.template({
      slot: 'member', collection: listing,
      steps: member => ({score: member.memo({
        subject: member.subject('score'),
        run: ({member: input}) => { bodyKeys.push(input.key); return {score: input.score}; },
      })}),
    });
    const composition = api.compose({scope:'collections',inputs:[{slot:'size',value:size}],steps:[{slot:'listing',declaration:listing}],templates:[template]});
    const location = `scratch/gap-hunt/subtree-query/store-${size}-${process.pid}.sqlite`;
    const workspace = openWorkspace({location,logicalStore:'collection',leaseMilliseconds:3600000});
    try {
      const resolved = await workspace.run({authoring:api,composition,environment:'synthetic'},run => run.resolveMembers({template:'member',step:'score'},{requestKey:`request:${size}:${process.pid}`}));
      expect(resolved.value.members.map(member => member.status)).toEqual(Array.from({length:size},() => 'succeeded'));
      expect(bodyKeys).toEqual(Array.from({length:size},(_,index) => `member:${index}`).sort());
      expect(sourceBodies).toBe(1);
    } finally { workspace.close(); }
    const workloadEvents = [...events];
    const subtree = workloadEvents.filter(event => event.role === 'subtree-payload' || event.role === 'subtree-structure');
    expect(subtree.map(event => [event.role,event.method,event.rows])).toEqual([['subtree-payload','all',3*size+3],['subtree-structure','all',3*size+2]]);
    expect(subtree.every(event => event.phase === 'discovery-read')).toBe(true);
    const firstMember = workloadEvents.findIndex(event => event.phase === 'member-attempt');
    expect(firstMember).toBeGreaterThan(workloadEvents.indexOf(subtree[1] ?? {phase:'',role:'',method:'',sql:'',values:[],rows:0}));
    // A separate real connection proves workspace close released the store and independently inspects retained results.
    const inspect = real.openSqlite(location);
    try {
      const results = inspect.prepare('SELECT analysis,environment,subject,version,payload FROM history_results ORDER BY subject').all();
      expect(results).toHaveLength(size+1);
      for (const row of results) {
        expect([row.analysis,row.environment,row.version]).toEqual(['collections','synthetic',1]);
        if (row.subject === 'listing') {
          expect(row.payload).toBe('MDS1|'+JSON.stringify(['o',[['members',['a',Array.from({length:size},(_,index) => ['o',[['key',['s',`member:${index}`]],['score',['d',String(index)]]],['p-object']])]],['status',['s','complete']]],['p-object']]));
        } else {
          expect(typeof row.subject).toBe('string');
          if (typeof row.subject !== 'string') { throw new Error('Expected score subject'); }
          const index = Number(row.subject.slice('score:member:'.length));
          expect(row.subject).toBe(`score:member:${index}`); expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(size);
          expect(row.payload).toBe('MDS1|'+JSON.stringify(['o',[['score',['d',String(index)]]],['p-object']]));
        }
      }
      expect(results.map(row => row.subject).sort()).toEqual(['listing',...Array.from({length:size},(_,index) => `score:member:${index}`)].sort());
      const statements = subtree.map(event => ({...event,sha256:createHash('sha256').update(event.sql).digest('hex'),plan:inspect.prepare('EXPLAIN QUERY PLAN '+event.sql).all(...event.values)}));
      const schema = inspect.prepare("SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
      const listingId = inspect.prepare("SELECT result_id FROM history_results WHERE subject='listing'").get()?.result_id;
      if (typeof listingId !== 'number') { throw new Error('Missing listing result id'); }
      const tables = {history_nodes:inspect.prepare('SELECT * FROM history_nodes WHERE result_id=? ORDER BY node_id').all(listingId),history_edges:inspect.prepare('SELECT * FROM history_edges WHERE result_id=? ORDER BY parent_node,edge_kind,edge_key').all(listingId)};
      const grouped = new Map<string,{calls:number;rows:number}>();
      for (const event of workloadEvents) { const key = `${event.phase}:${event.role}:${event.method}`; const old = grouped.get(key) ?? {calls:0,rows:0}; grouped.set(key,{calls:old.calls+1,rows:old.rows+event.rows}); }
      captures.push({size,location,sourceBodies,bodyKeys,closed:true,exact_retained_members_and_scores:true,statements,node_sqlite_version:inspect.prepare('SELECT sqlite_version() AS version').get(),schema,tables,counts:Object.fromEntries(grouped),all_events:workloadEvents});
    } finally {inspect.close();}
  }
  writeFileSync('scratch/gap-hunt/subtree-query/production-captures.json',JSON.stringify({pin:'f46223193696b67499322bdf70260b85a6277564',sizes:[10,20,40],captures},null,2)+'\n');
});

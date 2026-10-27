/** Fixed tiny child for actual parent deadline/RSS/reap controls; never loads a workload. */
if (process.argv[2] === 'normal') { setTimeout(() => { process.stdout.write('normal'); }, 100); }
else if (process.argv[2] === 'wait') { setInterval(() => undefined, 1000); }
else { throw new Error('unknown diagnostic control'); }

import {createMemoryStore} from 'microdelta';
const store=createMemoryStore();await store.meta();await store.close();console.log('public-memory-ok');

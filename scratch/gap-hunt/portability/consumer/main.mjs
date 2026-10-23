import {createMemoryStore} from "microdelta";
const store=createMemoryStore(); console.log(JSON.stringify(await store.meta())); await store.close();

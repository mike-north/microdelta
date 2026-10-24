/** Keep this consumer free of authoring calls so failures isolate declaration resolution. */
import { authoring } from 'microdelta';

void authoring;

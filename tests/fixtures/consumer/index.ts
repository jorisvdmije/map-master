import * as editor from '@geo/editor';

// A strict consumer must resolve the shipped declarations, with no source alias.
const publicApi: typeof import('@geo/editor') = editor;
void publicApi;

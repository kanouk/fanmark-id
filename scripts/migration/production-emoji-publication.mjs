#!/usr/bin/env node
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {runProductionEmojiPublication,parsePublicationArguments} from './staging-emoji-publication.mjs';
export {runProductionEmojiPublication};
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 process.umask(0o077);try{console.log(JSON.stringify(await runProductionEmojiPublication(parsePublicationArguments(process.argv.slice(2)))));}
 catch{console.error('production_emoji_publication_failed; inspect the private operation journal before any retry');process.exitCode=1;}
}

global = {window: {}};
importScripts('/assets/mpq.js');
const MPQ = global.window.MPQ;
const tokenizer = global.window.tokenizer;
const listfile = global.window.listfile;
const Maps = global.window.Maps;
const scanMap = global.window.scanMap;
const WMap = global.window.WMap;
const serialize = global.window.serialize;
const deserialize = global.window.deserialize;
const exportTokens = global.window.exportTokens;
const importTokens = global.window.importTokens;
const exportToWar = global.window.exportToWar;
const filesToExport = global.window.filesToExport.filesToProcess;
const FS = global.window.FS;

let filesToProcess = {}

for (const [name, info] of Object.entries(filesToExport)) {
  filesToProcess[name] = {props: info.props, name, paths: info.paths};
}

const findFiles = function(map, extraListFile) {
  console.log(extraListFile)
  postMessage({type: "message", message: "Finding map files"});
  const foundFiles = new Set();
  const files = new Set(listfile.concat(extraListFile));

  scanMap(map, files, foundFiles);
  postMessage({type: "message", message: "found " + foundFiles.size + " files"});

  return foundFiles;
}

async function deprotect(map, extraListFile) {
  const foundFiles = findFiles(map, extraListFile);

  let deprotected = await MPQ.create('/deprotected.mpq', {maxFiles: foundFiles.size + 20, fileFlagsListfile: 0x80000000});
  const mapLocale = map.mpq.locale();
  let idx = 0;
  for (const file of foundFiles) {
      if (idx++ % 100 == 0 || idx == foundFiles.size) postMessage({type: "message", message: `Loaded ${idx}/${foundFiles.size} files`, key: 'load-progress'});
      try {
          const buffer = map.readFile(file);
          if (buffer) {
            deprotected.addFileFromArrayBuffer(map.cleanName(file), buffer, {replace: true, compress: true});
            if (mapLocale != 'Neutral') {
              const f = deprotected.openFile(map.cleanName(file));
              f.setLocale(0); // neutral
              f.close();
            }
          }
      } catch (e) {
          postMessage({type: "message", message: 'failed to extract ' + file + ': ' + e});
      }
  }
  
  map.mpq.locale(0); //bring back locale to neutral

  postMessage({type: "message", message: `Finished deprotecting`});
  
  return WMap.fromMPQ(deprotected);
}

async function slkMap(map) {
  const newMap = await MPQ.create('/newMap.mpq', {maxFiles: listfile.length + 20, fileFlagsListfile: 0x80000000});
  for (const file of listfile) {
    try {
      const buffer = map.readFile(file);
      if (buffer) newMap.addFileFromArrayBuffer(map.cleanName(file), buffer, {replace: true, compress: true});
    } catch (e) {}
  }
  
  return WMap.fromMPQ(newMap);
}

let output;
let untranslatedTokens;
let map;
let warFiles;
const dec = new TextDecoder("utf-8");
const enc = new TextEncoder("utf-8");

const copyPreHeader = (oldBuffer, newBuffer) => {
  if (dec.decode(oldBuffer.slice(0, 4)) == 'HM3W') {
    const arr = new Uint8Array(newBuffer.byteLength + 0x200);
    arr.set(new Uint8Array(oldBuffer.slice(0, 0x200)), 0);
    arr.set(newBuffer, 0x200);
    return arr.buffer;
  }
  return newBuffer;
}

const loadMap = async function(buffer, listfile) {
    try {
        const mpq = await MPQ.fromArrayBuffer(buffer, {partial: false});
        map = WMap.fromMPQ(mpq);
        let isProtected = false;
        
        try {
            map.mpq.addFileFromArrayBuffer('testFileAdd.txt', new ArrayBuffer());
        } catch (e) {
            isProtected = true;
            postMessage({type: "message", message: "Map is protected, trying to deprotect"});
            map = await deprotect(map, listfile);
            if (dec.decode(buffer.slice(0, 4)) == 'HM3W') map.mpq = await MPQ.fromArrayBuffer(copyPreHeader(buffer, map.mpq.toArrayBuffer()), {partial: false});
            postMessage({type: "deprotected-map", message: map.mpq.toArrayBuffer()});
        }

        if (map.hasFile('Units/AbilityData.slk') || map.hasFile('Units/ItemData.slk')) {
            postMessage({type: "message", message: "Map looks to be in slk format. Try converting to obj format with <a href='https://www.hiveworkshop.com/threads/w3x2lni-v2-7-2.305201/' target='_blank'>w3x2lni</a>"});
            if (!isProtected) {
              const slk = await slkMap(map);
              postMessage({type: "message", message: "Download this slk version of the map and then import the obj version", actions: ['enable-actions']});
              postMessage({type: "slk-map", message: slk.mpq.toArrayBuffer()});
            }
        } else {
          loadStrings();
        }
    } catch (e) {
        console.log(e);
        postMessage({type: "message", message: e});
    }
}

let mpqBackup;

const loadStrings = function() {
  mpqBackup = map.mpq.toArrayBuffer();
  postMessage({type: "message", message: "Retrieving map strings"});

  warFiles = Array.from(map.fileIterator()).filter(a => a[0]);

  map.parseFiles();
  map.afterParseFiles();

  const maps = new Maps();
  maps.add(map);

  output = maps.process();
    
  let files = Object.fromEntries(Object.entries(filesToProcess).filter(a => output.hasOwnProperty(a[0]) && Object.values(output[a[0]]).length));

  postMessage({type: "message", message: "Finished retrieving map strings", files});
  postMessage({type: "message", message: "You should now download tokens, translate them with <a href='https://www.onlinedoctranslator.com/en/translationform' target='_blank' >Doc translator</a> and import them", actions: ['enable-tokens', 'enable-actions']});
}

const exportT = function(files, onlyKorean) {
    const newObj = {};
    for (const [name, file] of Object.entries(filesToExport)) {
      if (files.hasOwnProperty(name)) {
        newObj[name] = output[name];
        if (files[name].props) {
          for (const key of Object.keys(newObj[name])) {
            newObj[name][key] = Object.fromEntries(Object.entries(newObj[name][key]).filter(a => files[name].props.includes(a)));
          }
        }
      }
    }
    console.log(newObj)
    if (onlyKorean) exportTokens.extraPlugins = [{shouldTranslateString: (str) => str.match(/[\u3131-\uea60]/)}];
    else exportTokens.extraPlugins = [];
    untranslatedTokens = exportTokens.afterParse(newObj);
    postMessage({type: "tokens", message: untranslatedTokens});
}

const importT = function(translatedTokens, importQty) {
    importTokens.afterParse(output, untranslatedTokens.trimEnd().split('\n'), translatedTokens.trimEnd().split('\n'));
    
    if (importQty == 1) {
        postMessage({type: "message", "message": "Imported tokens, should do it again", actions: ["enable-tokens"]});
    } else {
        postMessage({type: "message", "message": "Done importing tokens. You can now download map or download + import yaml to edit translation", actions: ["done-importing"]});        
    }
}

const translateMap = async function() {
    map.mpq = await MPQ.fromArrayBuffer(mpqBackup, {partial: false});
  
    for (const [buffer, file] of warFiles) {
        map.mpq.addFileFromArrayBuffer(map.cleanName(file), buffer, {replace: true});
    }

    map.parseFiles();
    exportToWar(map, output);
    try {
      map.mpq.compact();
    } catch (e) {} 
    postMessage({type: "map", message: map.mpq.toArrayBuffer()})
}

const translateMapFiles = async function() {
  map.mpq = await MPQ.create('/translated.mpq', {maxFiles: 50, fileFlagsListfile: 0x80000000});
  
  for (const [buffer, file] of warFiles) {
      map.mpq.addFileFromArrayBuffer(map.cleanName(file), buffer, {replace: true});
  }

  map.parseFiles();
  exportToWar(map, output);
  postMessage({type: "map", message: map.mpq.toArrayBuffer()})
}

const importMap = async function(objMap) {
  const mpq = await MPQ.fromArrayBuffer(objMap, {partial: false});
  
  for (const file of listfile.filter(l => !l.startsWith('(')).map(f => map.cleanName(f))) {
    try {
      if (mpq.hasFile(file)) map.mpq.addFileFromArrayBuffer(file, mpq.readFile(file), {replace: true, compress: true});
      else if (map.hasFile(file)) map.mpq.removeFile(file);
    } catch (e) {console.log(e, file)}
  }
  
  postMessage({type: "obj-map", message: map.mpq.toArrayBuffer()});
  
  loadStrings();
}

onmessage = function(e) {
  try {
    if (e.data.type == "load-map") {
      loadMap(e.data.message, e.data.listfile);
    } else if (e.data.type == "export-tokens") {
      exportT(e.data.files, e.data.onlyKorean);
    } else if (e.data.type == "import-tokens") {
      importT(e.data.message, e.data.importQty);
    } else if (e.data.type == "download-yaml") {
      postMessage({type: "yaml", message: serialize("yaml", output)});
    } else if (e.data.type == "import-yaml") {
      output = deserialize("yaml", e.data.message);
      postMessage({type: "message", message: "Done importing yaml"});
    } else if (e.data.type == "download-map") {
      translateMap();
    } else if (e.data.type == "import-map") {
      importMap(e.data.message);
    } else if (e.data.type == "download-translated-files") {
      translateMapFiles();
    }
  } catch (e) {
    console.error(e);
    postMessage({type: "message", message: "error: " + e.message});
  }
}

WMap.prototype.writeWar = function(name, file) {
    let toWar = file.toWar(this[name]);
    if (typeof toWar == "string") toWar = enc.encode(toWar); // war3mapSkin.txt comes as string
    if (toWar.errors && toWar.errors.length) postMessage({type: "message", message: "Error writing file " + name + ': ' + toWar.errors});
    map.mpq.addFileFromArrayBuffer(this.namesToFiles[name], toWar, {replace: true});
}

WMap.prototype.validateScript = () => {};

postMessage({type: "init"});
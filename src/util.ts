import { sep as SEP}  from 'path';
import {workspace,Uri} from "vscode"


export function getWorkspaceFolder(){
  let folders = workspace.workspaceFolders;
  if(!folders)
    throw new Error("No workspace folder found");
  return folders[0].uri.fsPath;
}

export function getConfigure<T>(father:string,son:string){
  return workspace.getConfiguration(father).get<T>(son);
}


function pathToUri(path: string) {
	try {
		return Uri.file(path);
	} catch (e) {
		return Uri.parse(path);
	}
}

export function toLocalPath(path:string){
  if(path.length >= 1 && path[0] !== '/'){
      let root = getWorkspaceFolder();
      if(path[0] === '.'){
          path = root + path.substring(1);
      }else{
          path = root +SEP+ path;
      }
  }
  return path;
}

export async function hasFile(path:string){
  path = toLocalPath(path);
  try {
    await workspace.fs.stat(pathToUri(path));
    return true;
  }catch(e){
    return false;
  }
}

export async function readFile(path: string) {
  path = toLocalPath(path);
  try {
    return await workspace.fs.readFile(pathToUri(path));
  } catch (e) {
    console.log("readFile error",e);
    return ;
  }
}

export async function writeFile(path: string, contents: Uint8Array) {
  path = toLocalPath(path);
  await workspace.fs.writeFile(pathToUri(path), contents);
}


export function stringReplace(str:string,p:string,r:string):string
{
    while (str.indexOf(p)!== -1) {
        str = str.replace(p,r);
    } 
    return str;
}
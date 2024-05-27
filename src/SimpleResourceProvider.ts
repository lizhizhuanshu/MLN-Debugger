
import { ResourceProvider } from './MLNDebugger';
import {getWorkspaceFolder, readFile,stringReplace} from "./util"
import { sep as SEP}  from 'path';
import {FileSystemWatcher, workspace} from 'vscode';

export class SimpleResourceProvider implements ResourceProvider {

  private codeRoot: string;
  private listener?: (path: string) => void;
  private watcher?:FileSystemWatcher;
  constructor(root:string){
    this.codeRoot = this.asRelativePath(root)
  }
  getResource(path: string): Promise<Uint8Array | undefined> {
    if(path.endsWith(".lua")){
      return this.getCode(path)
    }else{
      return readFile(`.${SEP}${path}`);
    }
  }
  asRelativePath(path: string): string {
    return workspace.asRelativePath(getWorkspaceFolder()+SEP+path)
  }

  getCode(path: string): Promise<Uint8Array | undefined> {
    return readFile(this.codeRoot + SEP + path);
  }


  onChanged(listener?: ((path: string) => void) | undefined): void {
    this.listener = listener
    if(this.listener && !this.watcher){
      this.watcher = workspace.createFileSystemWatcher(`**/${this.codeRoot}/**/*.lua`);
      this.watcher.onDidChange((uri)=>{
        let path = workspace.asRelativePath(uri)
        console.debug("source dir on didchange",path)
        this.listener && this.listener(path.substring(this.codeRoot.length+1));
      })
      this.watcher.onDidDelete((uri)=>{
        this.listener && this.listener(uri.fsPath.substring(this.codeRoot.length+1));
      })
    }else if(!this.listener && this.watcher){
      this.watcher.dispose();
      this.watcher = undefined;
    }
  }

}

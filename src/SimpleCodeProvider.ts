
import { CodeProvider } from './MLNDebugger';
import {getWorkspaceFolder, readFile,stringReplace} from "./util"
import { sep as SEP}  from 'path';
import {FileSystemWatcher, workspace} from 'vscode';

export class SimpleCodeProvider implements CodeProvider {

  private root: string;
  private listener?: (path: string) => void;
  private watcher?:FileSystemWatcher;
  constructor(root:string){
    this.root = this.asRelativePath(root)
  }
  asRelativePath(path: string): string {
    return workspace.asRelativePath(getWorkspaceFolder()+SEP+path)
  }

  getCode(path: string): Promise<Uint8Array | undefined> {
    return readFile(this.root + SEP + path);
  }


  onChanged(listener?: ((path: string) => void) | undefined): void {
    this.listener = listener
    if(this.listener && !this.watcher){
      this.watcher = workspace.createFileSystemWatcher(`**/${this.root}/**/*.lua`);
      this.watcher.onDidChange((uri)=>{
        let path = workspace.asRelativePath(uri)
        console.debug("source dir on didchange",path)
        this.listener && this.listener(path.substring(this.root.length+1));
      })
      this.watcher.onDidDelete((uri)=>{
        this.listener && this.listener(uri.fsPath.substring(this.root.length+1));
      })
    }else if(!this.listener && this.watcher){
      this.watcher.dispose();
      this.watcher = undefined;
    }
  }

}

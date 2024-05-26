export interface CodeProvider {
  getCode(path:string):Promise<Uint8Array|undefined>;
  onChanged(listener?:(path:string)=>void):void;
  asRelativePath(path:string):string;
}

export type OnLogListener = (log: string,path?:string) => void;
export type OnErrorListener = (error: string,path?:string) => void;




export interface MLNDebugger {
  start():void;
  stop(): void;
  reload():void;
}



export interface MLNDebuggerBuilder {
  build(): MLNDebugger;

  setPort(port: number): MLNDebuggerBuilder;
  setAddress(address: string): MLNDebuggerBuilder;
  setEntryFile(entryFile: string): MLNDebuggerBuilder;
  onLog(listener: OnLogListener): MLNDebuggerBuilder;
  onError(listener: OnErrorListener): MLNDebuggerBuilder;
  setCodeProvider(codeProvider: CodeProvider): MLNDebuggerBuilder;
}
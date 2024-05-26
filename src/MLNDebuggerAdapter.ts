
import {Server, Socket, createServer} from 'net';
import { CodeProvider, MLNDebugger, MLNDebuggerBuilder, OnErrorListener, OnLogListener } from './MLNDebugger';
import { InstructionType } from "./generated/PBBaseCommand"
import { decodepb_get_code_request } from './generated/PBGetCodeRequest';
import { encodepb_get_code_response, pb_get_code_response } from './generated/PBGetCodeResponse';
import { decodepblogcommand } from './generated/PBLogCommand';
import { decodepberrorcommand } from './generated/PBErrorCommand';
import { encodepbentryfilecommand,pbentryfilecommand } from './generated/PBEntryFileCommand';
import { encodepbreloadcommand,pbreloadcommand } from './generated/PBReloadCommand';

import * as HttpParser from "http-parser-js"
import { encodepbupdatecommand, pbupdatecommand } from './generated/PBUpdateCommand';
import * as os from 'os';
import { decodepbdevicecommand } from './generated/PBDeviceCommand';


function getLocalIPAddress(): string | undefined {
	const interfaces = os.networkInterfaces();
	for (const name of Object.keys(interfaces)) {
			for (const iface of interfaces[name]!) {
					if ('IPv4' === iface.family && !iface.internal) {
							return iface.address;
					}
			}
	}
	return undefined;
}


enum SessionType {
  UNKNOWN = 0,
  PROTOBUF = 1,
  HTTP = 2
}

const NULL_BUFFER = Buffer.alloc(0);

class ClientContext {
  sessionType: SessionType = SessionType.UNKNOWN;
  buffer: Buffer =NULL_BUFFER;
  parser?:HttpParser.HTTPParserJS
  url?:string;
  timeoutToken?:NodeJS.Timeout;
}

class MLNDebuggerAdapterByNet implements MLNDebugger {
  private port: number;
  private address: string;
  private entryFile:string;
  private server: Server;
  private clients: Socket[] = [];
  private clientContext = new Map<Socket,ClientContext>();
  private codeProvider: CodeProvider;

  private logListener?:OnLogListener;
  private errorListener?:OnErrorListener;

  private static readonly HEADER_LENGTH_PING = 7;
  private static readonly HEADER_LENGTH_PONG = 7;
  private static readonly HEADER_LENGTH_MESSAGE = 9;
  private static readonly MIN_HEADER_SIZE = 7;

  private static readonly MAGIC_MESSAGE = 0x01;
  private static readonly MAGIC_PING = 0x02;
  private static readonly MAGIC_PONG = 0x03;
  private static readonly MAGIC_END  = 0x04;

  private removeClient(socket:Socket){
    let index = this.clients.indexOf(socket);
    if(index>=0){
      this.clients.splice(index,1);
    }
  }

  onHandleProtoBufData = async (socket: Socket,context:ClientContext, nowBuffer: Buffer)=> {
    let type = nowBuffer.readUint8(0);
    if(type == MLNDebuggerAdapterByNet.MAGIC_PING){
      if(nowBuffer.byteLength>MLNDebuggerAdapterByNet.HEADER_LENGTH_PING){
        context.buffer = Buffer.from(nowBuffer, MLNDebuggerAdapterByNet.HEADER_LENGTH_PING);
        return;
      }
    }else if(type == MLNDebuggerAdapterByNet.MAGIC_PONG){
      if(nowBuffer.byteLength>MLNDebuggerAdapterByNet.HEADER_LENGTH_PONG){
        context.buffer = Buffer.from(nowBuffer, MLNDebuggerAdapterByNet.HEADER_LENGTH_PONG);
        return;
      }
    }else {
      if(nowBuffer.byteLength<MLNDebuggerAdapterByNet.HEADER_LENGTH_MESSAGE){
        context.buffer = nowBuffer;
        return;
      }

      let length = nowBuffer.readInt32BE(5);
      if(nowBuffer.byteLength<MLNDebuggerAdapterByNet.HEADER_LENGTH_MESSAGE+length+1){
        context.buffer = nowBuffer;
        return;
      }
      let messageType = nowBuffer.readInt32BE(1);
      console.log("onHandleProtoBufData",messageType,length)
      let message = nowBuffer.slice(9, MLNDebuggerAdapterByNet.HEADER_LENGTH_MESSAGE+length);
      let otherBuffer
      if(nowBuffer.byteLength>MLNDebuggerAdapterByNet.HEADER_LENGTH_MESSAGE +length+1){
        otherBuffer = Buffer.from(nowBuffer, MLNDebuggerAdapterByNet.HEADER_LENGTH_MESSAGE+length+1);
      }else{
        otherBuffer = NULL_BUFFER;
      }
      if(messageType == InstructionType.GET_CODE_REQUEST){
        let request = decodepb_get_code_request(message);
        let response:pb_get_code_response = {
          id: request.id,
        }
        if(request.path){
          context.buffer = otherBuffer;
          response.code = await  this.codeProvider.getCode(request.path);
          otherBuffer = context.buffer;
        }
        let responseBuffer = encodepb_get_code_response(response);
        this.sendMessage(socket, InstructionType.GET_CODE_RESPONSE, responseBuffer)
      }else if(messageType == InstructionType.LOG){
        let request = decodepblogcommand(message);
        if(this.logListener && request.log){
          this.logListener(request.log,request.relativeEntryFilePath);
        }
      }else if(messageType == InstructionType.ERROR){
        let request = decodepberrorcommand(message);
        if(this.errorListener && request.error){
          this.errorListener(request.error,request.relativeEntryFilePath);
        }
      }else if(messageType == InstructionType.DEVICE){
        let command = decodepbdevicecommand(message)
        console.log(`Device name: ${command.name} model : ${command.model}`)
      }
      else{
        console.error(`Unknown message type: ${messageType}`);
      }
      if(otherBuffer.byteLength>MLNDebuggerAdapterByNet.MIN_HEADER_SIZE){
        this.onHandleProtoBufData(socket,context, otherBuffer);
      }else if(otherBuffer.byteLength>0){
        context.buffer = otherBuffer;
      }else{
        context.buffer = NULL_BUFFER;
      }
    }
  }
  
  onHandleData = (socket: Socket, data: Buffer)=> {
    let context = this.clientContext.get(socket);
    if(context === undefined) {
      return;
    }
    let nowBuffer;
    if(context.buffer.byteLength>0){
      nowBuffer = Buffer.concat([context.buffer, data]);
      context.buffer = NULL_BUFFER;
    }else{
      nowBuffer = data;
    }
    if(nowBuffer.byteLength<MLNDebuggerAdapterByNet.MIN_HEADER_SIZE){
      context.buffer = nowBuffer;
      return;
    }
    if(context.sessionType == SessionType.UNKNOWN){
      if("GET" == nowBuffer.toString("utf8",0,3)){
        console.log("on HTTP request")
        context.sessionType = SessionType.HTTP;
        context.parser = new HttpParser.HTTPParser(HttpParser.HTTPParser.REQUEST);
        context.parser[HttpParser.HTTPParser.kOnHeadersComplete] = (headers)=>{
          context.url = headers.url;
        }
        context.parser[HttpParser.HTTPParser.kOnMessageComplete] = async ()=>{
          if(context.url){
            let code = await this.codeProvider.getCode(context.url);
            if(code){
              socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${code.byteLength}\r\nContent-Type: application/octet-stream\r\n\r\n`);
              socket.write(code);
              return
            }
          }
          socket.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
        }
        this.removeClient(socket);
      }else{
        context.sessionType = SessionType.PROTOBUF;
      }
    }

    if(context.sessionType == SessionType.PROTOBUF){
      this.onHandleProtoBufData(socket,context, nowBuffer);
    }else{
      context.parser!.execute(nowBuffer);
    }
  }

  private sendMessage(socket:Socket, messageType:InstructionType, message:Uint8Array){
    console.log(`on send message ${messageType} ${message.byteLength}`)
    let length = message.byteLength;
    let buffer = Buffer.alloc(MLNDebuggerAdapterByNet.HEADER_LENGTH_MESSAGE+length+1);
    buffer.writeUInt8(MLNDebuggerAdapterByNet.MAGIC_MESSAGE,0);
    buffer.writeInt32BE(messageType,1);
    buffer.writeInt32BE(length,5);
    buffer.set(message,9);
    buffer.writeUInt8(MLNDebuggerAdapterByNet.MAGIC_END,9+length);
    socket.write(buffer);
  }

  private sendEntryFile(socket:Socket){
    let command = {} as pbentryfilecommand;
    command.entryFilePath = `http://${this.address}:${this.port}/${this.entryFile}`;
    command.relativeEntryFilePath = this.entryFile;
    let buffer = encodepbentryfilecommand(command);
    this.sendMessage(socket, InstructionType.ENTRY_FILE, buffer);
  }

  private async updateEntryFile(socket:Socket){
    let command = {} as pbupdatecommand;
    const data = await this.codeProvider.getCode(this.entryFile);
    command.fileData = data;
    command.relativeFilePath = this.entryFile;
    command.filePath = `http://${this.address}:${this.port}/${this.entryFile}`;
    let buffer = encodepbupdatecommand(command)
    this.sendMessage(socket, InstructionType.UPDATE, buffer);
  }



  resetEntryFile(entryFile:string){
    this.entryFile = entryFile;
    this.clients.forEach((socket)=>{
      this.sendEntryFile(socket);
    });
  }

  reload(updateEntryFile:boolean = false){
    this.clients.forEach((socket)=>{
      this.sendReload(socket);
      if(updateEntryFile){
        this.updateEntryFile(socket);
      }
    });
  }

  private sendReload(socket:Socket){
    let command = {} as pbreloadcommand;
    command.serialNum = "0"
    let buffer = encodepbreloadcommand(command);
    this.sendMessage(socket, InstructionType.RELOAD, buffer);
  }

  constructor(port: number, address: string,entryFile:string,codeProvider: CodeProvider) {
    this.port = port;
    this.address = address;
    this.entryFile = codeProvider.asRelativePath(entryFile);
    this.codeProvider = codeProvider;
    let server = createServer((socket)=>{
      console.log(`Client connected: ${socket.remoteAddress}:${socket.remotePort}`);
      const context = new ClientContext();
      this.clientContext.set(socket, context);
      this.clients.push(socket);
      context.timeoutToken = setTimeout(async ()=>{
        context.timeoutToken = undefined;
        if(context.sessionType != SessionType.HTTP){
          this.sendEntryFile(socket);
          await this.updateEntryFile(socket);
          this.sendReload(socket);
        }
      },1000)

      socket.on("data", (data: Buffer)=>{
        this.onHandleData(socket, data);
      });

      socket.on("close", ()=>{
        console.log(`Client disconnected: ${socket.remoteAddress}:${socket.remotePort}`);
        this.clientContext.delete(socket);
        this.removeClient(socket);
      });

      socket.on("error", (error)=>{
        console.error(`Client error: ${socket.remoteAddress}:${socket.remotePort} ${error.message}`);
      });
    });


    server.on("error", (error)=>{
      console.error(`Server error: ${error.message}`);
    })

    server.on("close", ()=>{
      console.log(`Server closed`);
      this.clients = [];
      this.clientContext.clear();
    })
    this.server = server
  }

  start(): void {
    if(this.server.listening){
      return;
    }
    this.codeProvider.onChanged((path)=>{
      this.reload(path == this.entryFile);
    })

    this.server.listen(this.port, this.address,()=>{
      console.log(`Server is listening on ${this.address}:${this.port}`);
      if(this.logListener){
        this.logListener(`Please connect ${getLocalIPAddress()}:${this.port} to start debugging`);
      }
    });
  }
  stop(): void {
    if(!this.server.listening){
      return;
    }
    this.server.close();
    this.clients.forEach((socket)=>{
      socket.destroy();
    })
    this.codeProvider.onChanged(undefined)
  }

  onLog(listener: OnLogListener): void {
    this.logListener = listener;
  }

  onError(listener: OnErrorListener): void {
    this.errorListener = listener;
  }

}



export class Builder implements MLNDebuggerBuilder {
  private port?: number;
  private address: string = "";
  private entryFile:string = "index.lua";
  private codeProvider?: CodeProvider;
  private logListener?:OnLogListener;
  private errorListener?:OnErrorListener;

  build(): MLNDebugger {
    if(this.codeProvider === undefined){
      throw new Error("Code provider is not set");
    }
    if(this.port === undefined){
      throw new Error("Port is not set");
    }
    if(this.address === ""){
      this.address = getLocalIPAddress() || ""
    }

    console.log(`Builder.build ${this.port} ${this.address} ${this.entryFile}`)
    let result = new MLNDebuggerAdapterByNet(this.port, this.address,this.entryFile,this.codeProvider);
    if(this.logListener){
      result.onLog(this.logListener);
    }
    if(this.errorListener){
      result.onError(this.errorListener);
    }


    return result
  }
  setPort(port: number): MLNDebuggerBuilder {
    this.port = port;
    return this;
  }
  setAddress(address: string): MLNDebuggerBuilder {
    this.address = address;
    return this;
  }

  setEntryFile(entryFile:string): MLNDebuggerBuilder {
    this.entryFile = entryFile;
    return this;
  }

  onLog(listener: OnLogListener): MLNDebuggerBuilder {
    this.logListener = listener;
    return this;
  }
  onError(listener: OnErrorListener): MLNDebuggerBuilder {
    this.errorListener = listener;
    return this;
  }
  setCodeProvider(codeProvider: CodeProvider): MLNDebuggerBuilder {
    this.codeProvider = codeProvider;
    return this;
  }



}

import {
	LoggingDebugSession,
	InitializedEvent,  OutputEvent,
	Source,
	TerminatedEvent
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Subject } from 'await-notify';
import { basename } from 'path';

import {getConfigure,hasFile} from "./util";

import { MLNDebuggerBuilder,MLNDebugger, ResourceProvider } from './MLNDebugger';
import { Builder } from './MLNDebuggerAdapter';
import { SimpleResourceProvider } from './SimpleResourceProvider';


interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	entryFile:string;
	host?:string;
	port?:number;
	sourceDir?:string;
}

export class MLNDebugSession extends LoggingDebugSession{
	private builder:MLNDebuggerBuilder;
	private debugger?:MLNDebugger;
	private resourceProvider?:ResourceProvider;
	private _configurationDone = new Subject();
	public constructor(){
		super("mln-debug.txt");
		this.builder= new Builder()

		const port = getConfigure<number>("mln.debugger","port") || 8176;
		const entryFile = getConfigure<string>("mln.debugger","entryFile") || "index.lua";

		this.builder.setPort(port);
		this.builder.setEntryFile(entryFile);
		this.builder.onLog((message,path)=>{
			const e: DebugProtocol.OutputEvent = new OutputEvent(`${message}\n`);
			if(path){
				e.body.source = this.createSource(path);
			}

			this.sendEvent(e);
		})

		this.builder.onError((message,path)=>{
			const e: DebugProtocol.OutputEvent = new OutputEvent(`error ${message}\n`);
			if(path)
				e.body.source = this.createSource(path);
			this.sendEvent(e);
		})


	}


	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {
		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// the adapter implements the configurationDoneRequest.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code to use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = true;

		// make VS Code to show a 'step back' button
		response.body.supportsStepBack = true;

		// make VS Code to support data breakpoints
		response.body.supportsDataBreakpoints = true;

		// make VS Code to support completion in REPL
		response.body.supportsCompletionsRequest = true;
		response.body.completionTriggerCharacters = [ ".", "[" ];

		// make VS Code to send cancelRequests
		response.body.supportsCancelRequest = true;

		response.body.supportsTerminateRequest = true;

		// make VS Code send the breakpointLocations request
		response.body.supportsBreakpointLocationsRequest = true;

		// make VS Code provide "Step in Target" functionality
		response.body.supportsStepInTargetsRequest = true;
		
		this.sendResponse(response);

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());
	}

	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);
		// notify the launchRequest that configuration has finished
		console.log("configure done")
		this._configurationDone.notify();
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: ILaunchRequestArguments) {
		await this._configurationDone.wait(1000);
		if(args.port){
			this.builder.setPort(args.port);
		}
		if(args.entryFile){
			this.builder.setEntryFile(args.entryFile);
		}
		const sourceDir = args.sourceDir || getConfigure<string>("mln.debugger","sourceDir") || "src";
		this.resourceProvider = new SimpleResourceProvider(sourceDir);
		this.builder.setCodeProvider(this.resourceProvider);

		this.debugger = this.builder.build();
		if(this.debugger){
			this.debugger.start()
		}else{
			response.success=false;
			response.message="Failed to build engine";
			return this.sendResponse(response);
		}
		this.sendResponse(response);
	}

	protected terminateRequest(response:DebugProtocol.TerminateResponse,args:DebugProtocol.TerminateArguments)
	{
		this.debugger?.stop();
		this.sendResponse(response);
		this.sendEvent(new TerminatedEvent());
	}

	private createSource(filePath: string): Source {
		console.log(this.convertDebuggerPathToClient(filePath))
		return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'mln-adapter-data');
	}
}
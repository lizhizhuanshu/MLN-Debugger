'use strict';
import * as vscode from 'vscode';
import { ProviderResult } from 'vscode';
import { MLNDebugSession } from './MLNDebugSession';
export function activeMLNDebug(context:vscode.ExtensionContext)
{
	context.subscriptions.push(
		vscode.debug.registerDebugAdapterDescriptorFactory(
			"mln-debugger",
			new InlineDebugAdapterFactory()));
	
}


class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {

	createDebugAdapterDescriptor(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
		return new vscode.DebugAdapterInlineImplementation(new MLNDebugSession());
	}
}

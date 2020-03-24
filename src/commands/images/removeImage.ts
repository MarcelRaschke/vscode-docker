/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ImageInfo } from 'dockerode';
import vscode = require('vscode');
import { IActionContext } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { localize } from '../../localize';
import { ImageTreeItem } from '../../tree/images/ImageTreeItem';
import { callDockerodeWithErrorHandling } from '../../utils/callDockerodeWithErrorHandling';
import { multiSelectNodes } from '../../utils/multiSelectNodes';

export async function removeImage(context: IActionContext, node?: ImageTreeItem, nodes?: ImageTreeItem[]): Promise<void> {
    nodes = await multiSelectNodes(
        { ...context, suppressCreatePick: true, noItemFoundErrorMessage: localize('vscode-docker.commands.images.remove.noImages', 'No images are available to remove') },
        ext.imagesTree,
        ImageTreeItem.contextValue,
        node,
        nodes
    );

    let confirmRemove: string;
    if (nodes.length === 1) {
        confirmRemove = localize('vscode-docker.commands.images.remove.confirmSingle', 'Are you sure you want to remove image "{0}"? This will remove all matching and child images.', nodes[0].label);
    } else {
        confirmRemove = localize('vscode-docker.commands.images.remove.confirmMulti', 'Are you sure you want to remove selected images? This will remove all matching and child images.');
    }

    // no need to check result - cancel will throw a UserCancelledError
    await ext.ui.showWarningMessage(confirmRemove, { modal: true }, { title: 'Remove' });

    let removing: string = localize('vscode-docker.commands.images.remove.removing', 'Removing image(s)...');
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: removing }, async () => {
        const deleteList = await computeOrderedDeletionList(nodes);

        for (const image of deleteList) {
            const di = ext.dockerode.getImage(image.Id);
            await callDockerodeWithErrorHandling(async () => di.remove({ force: true }), context);
        }

        await ext.imagesRoot.refresh();
    });
}

interface ImageDeleteInfo extends ImageInfo {
    depth?: number;
    delete?: boolean;
}

async function computeOrderedDeletionList(nodes: ImageTreeItem[]): Promise<ImageInfo[]> {
    const allImages: ImageDeleteInfo[] = await ext.dockerode.listImages({ all: true });

    // Mark all selected nodes as delete targets
    allImages.forEach(i => i.delete = nodes.some(n => n.imageId === i.Id));

    // Walk all trees down from root images to mark delete and depth
    for (const rootImage of allImages.filter(i => !i.ParentId)) {
        rootImage.depth = 0;
        recursiveGetImageDeleteInfo(rootImage, allImages);
    }

    return allImages
        .sort((a, b) => b.depth - a.depth) // Sort by depth descending (so we delete from bottom of the tree up to top)
        .filter(i => { // Choose images that are marked for delete and (is leaf node or has a tag) (those that are untagged, non-leaf nodes are automatically deleted when their leaf is deleted)
            return i.delete &&
                !allImages.some(ip => ip.ParentId === i.Id) || i.RepoTags.some(t => !t.startsWith('<none>'));
        });
}

function recursiveGetImageDeleteInfo(parent: ImageDeleteInfo, allImages: ImageDeleteInfo[]): void {
    for (const child of allImages.filter(i => i.ParentId === parent.Id)) {
        // Set the child's depth
        child.depth = parent.depth + 1;

        // Propagate down any delete === true, otherwise leave it unchanged (could be false, could already be true)
        if (parent.delete) {
            child.delete = true;
        }

        recursiveGetImageDeleteInfo(child, allImages);
    }
}

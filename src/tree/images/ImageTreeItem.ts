/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Image, ImageInfo } from 'dockerode';
import { AzExtParentTreeItem, AzExtTreeItem, IActionContext, IParsedError, parseError } from "vscode-azureextensionui";
import { ext } from '../../extensionVariables';
import { callDockerodeWithErrorHandling } from '../../utils/callDockerodeWithErrorHandling';
import { getThemedIconPath, IconPath } from '../IconPath';
import { ILocalImageInfo } from './LocalImageInfo';

export class ImageTreeItem extends AzExtTreeItem {
    public static contextValue: string = 'image';
    public contextValue: string = ImageTreeItem.contextValue;
    private readonly _item: ILocalImageInfo;

    public constructor(parent: AzExtParentTreeItem, itemInfo: ILocalImageInfo) {
        super(parent);
        this._item = itemInfo;
    }

    public get id(): string {
        return this._item.treeId;
    }

    public get createdTime(): number {
        return this._item.createdTime;
    }

    public get imageId(): string {
        return this._item.imageId;
    }

    public get fullTag(): string {
        return this._item.fullTag;
    }

    public get label(): string {
        return ext.imagesRoot.getTreeItemLabel(this._item);
    }

    public get description(): string | undefined {
        return ext.imagesRoot.getTreeItemDescription(this._item);
    }

    public get iconPath(): IconPath {
        let icon: string;
        switch (ext.imagesRoot.labelSetting) {
            case 'Tag':
                icon = 'tag';
                break;
            default:
                icon = 'application';
        }
        return getThemedIconPath(icon);
    }

    public getImage(): Image {
        return ext.dockerode.getImage(this.imageId);
    }

    public async deleteTreeItemImpl(context: IActionContext): Promise<void> {
        const childImages = await this.getChildImages();

        for (const childImage of childImages) {
            const ci = ext.dockerode.getImage(childImage.Id);
            // eslint-disable-next-line @typescript-eslint/promise-function-async
            await callDockerodeWithErrorHandling(() => ci.remove({ force: true }), context);
        }

        const image: Image = this.getImage();
        try {
            // eslint-disable-next-line @typescript-eslint/promise-function-async
            await callDockerodeWithErrorHandling(() => image.remove({ force: true }), context);
        } catch (error) {
            const parsedError: IParsedError = parseError(error);

            // Ignore 404 errors since it's possible this image was already deleted
            if (parsedError.errorType !== '404' && parsedError.errorType.toLowerCase() !== 'notfound') {
                throw error;
            }
        }
    }

    private async getChildImages(): Promise<ImageInfo[]> {
        const allImages = await ext.dockerode.listImages({ all: true });

        return recursiveGetChildImages(allImages.find(i => i.Id === this.imageId), allImages);
    }
}

function recursiveGetChildImages(image: ImageInfo, allImages: ImageInfo[]): ImageInfo[] {
    const childImages = allImages.filter(i => i.ParentId === image.Id);
    let results: ImageInfo[] = [];

    if (childImages.length === 0 && image.RepoTags.every(r => r === '<none>:<none>')) {
        // If it has no children and no tags, it is dangling, so include it in the list to delete
        results.push(image);
    } else {
        // Otherwise, get all tagged/dangling children from here
        for (const childImage of childImages) {
            // Depth-first search
            results = results.concat(recursiveGetChildImages(childImage, allImages));

            if (childImage.RepoTags) {
                for (const repoTag of childImage.RepoTags) {
                    if (repoTag !== '<none>:<none>') {
                        results.push(childImage);
                    }
                }
            }
        }
    }

    return results;
}

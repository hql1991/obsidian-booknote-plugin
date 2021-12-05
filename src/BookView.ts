
import { ItemView, MarkdownEditView, MarkdownView, Menu, Notice, WorkspaceLeaf } from "obsidian";
import WebViewer from "@pdftron/webviewer";
import BookNotePlugin from "./main";

import {clipPDF, getPDFDocFromData} from "./PDFHelper"


export const VIEW_TYPE_BOOK_VIEW = "book-view";
export class BookView extends ItemView {
	currentBook: any;
	plugin: BookNotePlugin;
	listener: any;
	viewerReady: boolean;
	documentReady: boolean;
	viewerId: string;
	eventHandlerMap: any;
	headerTitleEl: Element;

	xfdfDoc: Document;
	annotsDoc: Element;
	isAnnotsChanged: boolean;

	// TODO: when needed??
	pdfjsDoc: any;

	constructor(leaf: WorkspaceLeaf, plugin: BookNotePlugin) {
		super(leaf)
		this.plugin = plugin;
		this.viewerId = "wv-" + (this.leaf as any)?.id;
		this.viewerReady = false;
		this.documentReady = false;
		this.isAnnotsChanged = false;
		

		const self = this;
		this.eventHandlerMap = {
			viewerLoaded(data: any) {
				console.log("viewer ready");
				self.viewerReady = true;
			},
			documentLoaded(data: any) {
				self.xfdfDoc = self.plugin.parseXfdfString(data);
				self.annotsDoc = self.xfdfDoc.getElementsByTagName("annots")[0];

				self.isAnnotsChanged = false;
				self.documentReady = true;
			},
			
			copyAnnotationLink(data: any) {
				const id = data.id;
				const node = self.xfdfDoc.getElementsByName(id)[0];
				if (node) {

					self.getAnnotationLink(node,).then((content: string) => {
						navigator.clipboard.writeText(content);
						new Notice("回链已复制到剪贴板");
						if (data.ctrlKey) {
							if (self.app.workspace.activeLeaf.view.getViewType() === "markdown") { // insert to markdown
								(self.app.workspace.activeLeaf.view as MarkdownView).editor.replaceSelection(content);
	
							} else {
								new Notice("请先激活目标Markdown窗口");
							}
						}
				
					});

				} else {
					new Notice("标注id不存在");
					
				}
			},

			annotationChanged(data: any) {

				const annotsChanged = self.plugin.parseXfdfString(data.xfdf);
				const annotsAdd = annotsChanged.getElementsByTagName("add")[0].children;
				const annotsModify = annotsChanged.getElementsByTagName("modify")[0].children;
				const annotsDelete = annotsChanged.getElementsByTagName("delete")[0].children;
				
				
				if (!self.isAnnotsChanged && (annotsAdd.length || annotsDelete.length || annotsModify.length )) {
					self.isAnnotsChanged = true;
				}

				// TODO: 添加标签时进行复制??
				// if (annotsAdd.length > 0) {
				// 	self.copyAnnotationLink(annotsAdd[annotsAdd.length-1]);
				// }

				for(var i = 0; i < annotsAdd.length; i++) {
					self.annotsDoc.appendChild(annotsAdd[i]);
				}
				for(var i = 0; i < annotsModify.length; i++) {
					self.xfdfDoc.getElementsByName(annotsModify[i].getAttr("name"))[0].replaceWith(annotsModify[i]);
				}
				
				for(var i = 0; i < annotsDelete.length; i++) {
					self.xfdfDoc.getElementsByName(annotsDelete[i].textContent)[0].remove();
				}



				
			}
		}
	}


	async getAnnotationLink(anno: Element) {
		const annoType = anno.tagName;
		const annoId = anno.getAttr("name");
		const annoRect = anno.getAttr("rect");
		const annoPage = anno.getAttr("page");
		const link = encodeURI(`obsidian://booknote?type=annotation&book=${this.currentBook}&id=${annoId}&page=${annoPage}&rect=${annoRect}`);

		// TODO: declare moment??
		let template = "";
		let needComment = false;
		if (["highlight","underline" ,"strikeout","squiggly","freetext"].indexOf(annoType) >= 0) {
			template = this.plugin.settings.selectionAnnotationLinkTemplate;
			needComment = template.indexOf("{{comment}}") >= 0;
			template = template.replace("{{content}}",anno.textContent);
		} else {
			template = this.plugin.settings.regionAnnotationLinkTemplate;
			needComment = template.indexOf("{{comment}}") >= 0;
		}

		if (template.indexOf("{{img}}") >= 0) {

			const imgPath = this.plugin.normalizeBookDataPath(`(annotations)${this.currentBook}/p${annoPage}r${annoRect}i(${annoId}).png`);
			clipPDF(this.plugin, 
				this.pdfjsDoc,Number(annoPage	)+1,
				annoRect.split(",").map(t => Number(t)),
				imgPath);
			template = template.replace("{{img}}",imgPath);
		}

		template.replace("{{page}}",annoPage);
		template = template.replace("{{url}}",link);
		
		// TODO: more comment!
		if (needComment) {
			const commentEl = anno.getElementsByTagName("contents");
			template = template.replace("{{comment}}",commentEl.length ? commentEl[0].textContent : "");
		}

		return template;
	}

	showAnnotation(id: string) {
		this.postViewerWindowMessage("showAnnotation", id);
	}

	getDisplayText() {
		if (this.currentBook?.name) {
			return this.currentBook.name;
		} else {
			return "Book View";
		}
	}

	async openBook(bookpath: string, page?: Number) {

		const self = this;
		const promise = new Promise<BookView>((resolve,reject) => {
			
			if (self.currentBook === bookpath) {
				console.log("samebook");
				resolve(self);
				return;
			}

			// TODO: save annotations safely??
			if (self.xfdfDoc && self.isAnnotsChanged) {
				self.plugin.saveBookAnnotations(self.currentBook, self.xfdfDoc);
			}

			const fullPath = this.plugin.normalizeBookPath(bookpath);
			if (!self.plugin.fs.existsSync(fullPath)) {
				new Notice("文件不存在:"+fullPath);
				reject("文件不存在");
			} else {
				// TODO: good time to set title??
				self.headerTitleEl.setText(self.plugin.path.basename(bookpath));
				self.plugin.getBookAnnotations(bookpath).then(xfdfString => {
					this.plugin.fs.readFile(fullPath,(err: any, data: any) => {
						if (err) {
							console.error("can't read file:",fullPath);
							reject(err);
						} else {

							getPDFDocFromData(data).then(pdfDoc => {
								this.pdfjsDoc = pdfDoc;
							})

							const ext = self.plugin.path.extname(bookpath).substr(1)
							const arr = new Uint8Array(data);
							const blob = new Blob([arr], { type: 'application/'+ext });
							this.postViewerWindowMessage("openFile",{
								blob:blob,
								xfdfString: xfdfString,
								path: fullPath,
								extension: ext,
								page: page,
							})

							function waitDocumentReady() {
								if(!self.documentReady) {
									setTimeout(waitDocumentReady,100);
								} else {
									self.currentBook = bookpath;


									resolve(self);
								}
							}
							waitDocumentReady();				
						}

					});
				});
			}

			
		});

		return promise;
	}

	private getViewerWindow() {
		const self = this;
		const promise = new Promise<Window>((resolve,reject) => {
			function wait() {
				if(!self.viewerReady) {
					setTimeout(wait,100);
				} else {
					resolve((self.contentEl.children[0] as HTMLIFrameElement).contentWindow);
				}
			}
			wait();
		});
		return promise;
	}


	postViewerWindowMessage(type: string, data?: any) {
		this.getViewerWindow().then(window => {
			window.postMessage({
				app: "obsidian-book",
				type: type,
				data: data,
			},"*");
		})
	}
	

	getViewType() {
		return VIEW_TYPE_BOOK_VIEW;
	}



	async onOpen() {
		console.log("BookView Open");

		const self = this;
		this.contentEl.classList.add("webviewer-container");
		const workerPath = this.plugin.settings.useLocalWebViewerServer ? 
							"http://127.0.0.1:"+this.plugin.settings.webviewerLocalPort
							: this.plugin.settings.webviewerExternalServerAddress;

		WebViewer({
			path: workerPath,
			config: "config.js",
			custom: JSON.stringify({
				id: this.viewerId,
			}),
			preloadWorker: "pdf",
		},this.contentEl).then(instance => {

		});

		this.listener = function(event: any) {
			const data = event.data;
			if (!data["app"] || data["app"] !== self.viewerId)return;
			const handler = self.eventHandlerMap[data.type];
			if (handler) handler(data.data);
			
		}

		window.addEventListener("message", this.listener);

		this.headerTitleEl = this.containerEl.children[0].getElementsByClassName("view-header-title")[0];

		const actionsContainer = this.containerEl.children[0].children[2];
		const actionTemp = actionsContainer.children[0];
		actionsContainer.insertBefore(actionTemp,this.addAction("dice","占位",()=> {
			new Notice("广告位出租");
		}));
		actionsContainer.insertBefore(actionTemp,this.addAction("dice","占位",()=> {
			new Notice("广告位出租");
		}));
		actionsContainer.insertBefore(actionTemp,this.addAction("dice","占位",()=> {
			new Notice("广告位出租");
		}));
		
	}

	async onClose() {
		console.log("BookView Close");

		// TODO: saved safely??
		if (this.xfdfDoc && this.isAnnotsChanged) {
			this.plugin.saveBookAnnotations(this.currentBook,this.xfdfDoc);
		}
		window.removeEventListener("message",this.listener);
		this.viewerReady = false; 
	}

}
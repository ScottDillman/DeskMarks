/* global chrome, app, idbKeyval */
{
    const {ICON_WIDTH, ICON_HEIGHT, ICON_SPACING, GUTTER, getFaviconImageUrl,
           clampText, promisify, fixBackgroundSize, updateBackground,
           getNextBgInCycle, debounce, getParentElementWithClass} = app.util;
    const desktop = document.querySelector('#desktop');
    app.desktop = desktop;

    const data = app.data;

    function findNextOpenSpot() {
        for (let x = 0; x < 12; x++) {
            for (let y = 0; y < 6; y++) {
                if (!data.locations[`${x},${y}`]) {
                    return {x, y};
                }
            }
        }
        let y = 6;
        while (y < 99999) {
            for (let x = 0; x < 12; x++) {
                if (!data.locations[`${x},${y}`]) {
                    return {x, y};
                }
            }
            y++;
        }
    }

    async function makeBookmarkIcon(bookmark, currentPath, folder = false, container = desktop) {
        let icon = folder ? 'icons/folder.svg' : getFaviconImageUrl(bookmark.url);
        try {
            const iconBlob = await idbKeyval.get(bookmark.id);
            if (iconBlob) {
                icon = URL.createObjectURL(iconBlob);
            }
        } catch (e) {}
        const bookmarkIcon = document.createElement('div');
        bookmarkIcon.className = 'bookmark';
        bookmarkIcon.dataset.url = bookmark.url;
        bookmarkIcon.dataset.name = bookmark.title;
        bookmarkIcon.dataset.id = bookmark.id;
        bookmarkIcon.dataset.path = currentPath + '/' + bookmark.id;
        bookmarkIcon.dataset.folder = folder;
        bookmarkIcon.title = bookmark.title;
        const tag = folder ? 'div' : 'a';
        bookmarkIcon.innerHTML = `
            <${tag} class="bookmarkLink" draggable="false" href="${bookmark.url}">
                <div class="iconContainer">
                    <img class="icon" src="${icon}" alt="">
                </div>
                <div class="name">${bookmark.title}</div>
            </${tag}>
        `;
        const nameDiv = bookmarkIcon.querySelector('.name');
        const positionData = data.icons[bookmark.id] || findNextOpenSpot();
        positionData.url = bookmark.url;
        if (container === desktop) {
            bookmarkIcon.style.position = 'absolute';
            bookmarkIcon.style.left = positionData.x * (ICON_WIDTH + ICON_SPACING) + GUTTER + 'px';
            bookmarkIcon.style.top = positionData.y * (ICON_HEIGHT + ICON_SPACING) + GUTTER + 'px';
        }
        container.appendChild(bookmarkIcon);
        clampText(nameDiv, bookmark.title);
        data.locations[`${positionData.x},${positionData.y}`] = positionData;
    }

    app.saveData = () => {
        // side task to update background.
        fixBackgroundSize();

        data.icons = {};
        data.locations = {};
        desktop.children.forEach((child) => {
            if (child.classList.contains('bookmark')) {
                const left = parseInt(child.style.left);
                const top = parseInt(child.style.top);
                const x = (left - GUTTER) / (ICON_WIDTH + ICON_SPACING);
                const y = (top - GUTTER) / (ICON_HEIGHT + ICON_SPACING);
                const bookmarkObj = {
                    x,
                    y,
                    url: child.dataset.url,
                    name: child.dataset.name,
                    folder: child.dataset.folder === 'true'
                };
                data.icons[child.dataset.id] = bookmarkObj;
                data.locations[`${x},${y}`] = bookmarkObj;
            }
        });
        localStorage.data = JSON.stringify(data);
        desktop.children.forEach((child) => {
            if (child.classList.contains('bookmark')) {
                const obj = data.icons[child.dataset.id];
                const iconImg = child.querySelector('.icon');
                if (!iconImg.src.startsWith('chrome')) {
                    obj.image = iconImg.src;
                }
                obj.element = child;
            }
        });
    };

    const getBookmarkTree = promisify(chrome.bookmarks.getTree);

    async function render() {
        const bookmarkTree = await getBookmarkTree();
        desktop.innerHTML = '';
        const root = bookmarkTree[0];
        const rootChildren = root.children;

        const promises = [];
        // Create top level icons on "desktop"
        rootChildren.forEach((rNode) => {
            rNode.children.forEach((node) => {
                if (node.url) {
                    // this is a bookmark node
                    promises.push(makeBookmarkIcon(node, rNode.id));
                } else {
                    // this is a folder node
                    promises.push(makeBookmarkIcon(node, rNode.id, true));
                }
            });
        });
        Promise.all(promises).then(app.saveData);
    }
    render();

    async function getNodeFromPath(path) {
        const pathParts = path.split('/');
        const bookmarkTree = await getBookmarkTree();

        let currentNode = bookmarkTree[0];
        let currentPathPart = 0;
        let nextId = pathParts[currentPathPart];
        while (nextId !== undefined) {
            const nextNode = currentNode.children.find((node) => nextId === node.id);
            if (nextNode) {
                currentPathPart++;
                nextId = pathParts[currentPathPart];
                currentNode = nextNode;
            } else {
                return null;
            }
        }
        return currentNode;
    }

    async function renderFolder(path, container) {
        const pNode = await getNodeFromPath(path);
        pNode.children.forEach((node) => {
            if (node.url) {
                // this is a bookmark node
                makeBookmarkIcon(node, path, false, container);
            } else {
                // this is a folder node
                makeBookmarkIcon(node, path, true, container);
            }
        });
    }

    // Start checking if we need to switch backgrounds.
    setInterval(() => {
        const lastRotation = localStorage.lastRotation;
        const now = Date.now();
        if ((now - lastRotation) > data.rotateMinutes * 60 * 1000) {
            const nextBg = getNextBgInCycle(localStorage.lastBgId, data.backgrounds, data.random);
            if (nextBg) {
                updateBackground(nextBg);
                app.saveData();
            }
            localStorage.lastRotation = now;
        }
        if (localStorage.lastBgId !== data.background.id) {
            const newBg = data.backgrounds.find((bg) => bg.id === localStorage.lastBgId);
            if (newBg) {
                updateBackground(newBg);
            }
        }
    }, 3000);

    window.addEventListener('resize', () => {
        fixBackgroundSize();
    });

    window.addEventListener('click', (e) => {
        const iconEl = getParentElementWithClass(e.target, 'bookmark');
        if (iconEl) {
            const icon = app.data.icons[iconEl.dataset.id] || {};
            if (icon.folder) {
                e.preventDefault();
                const currentWindow = getParentElementWithClass(iconEl, 'window');
                if (!currentWindow) {
                    const width = 550;
                    const height = 400;
                    let x = iconEl.offsetLeft + iconEl.offsetWidth;
                    let y = iconEl.offsetTop;
                    if (x + width > window.innerWidth) {
                        x = iconEl.offsetLeft - width;
                    }
                    if (y + height > window.innerHeight) {
                        y = iconEl.offsetTop - height + iconEl.offsetHeight;
                    }
                    const win = app.makeWindow(icon.name, x, y, width, height);
                    //renderFolder('2/36/37/38', win.content);
                    renderFolder(iconEl.dataset.path, win.content);
                } else {
                    const content = currentWindow.querySelector('.content');
                    const title = currentWindow.querySelector('.title-bar .title');
                    title.textContent = iconEl.dataset.name;
                    content.innerHTML = '';
                    renderFolder(iconEl.dataset.path, content);
                }
            }
        }
    });

    const debouncedRender = debounce(render, 100);
    ['onCreated', 'onImportEnded', 'onMoved', 'onRemoved'].forEach((eventName) => {
        chrome.bookmarks[eventName].addListener(debouncedRender);
    });

    /*
    { // root folder node
        "children": [{ // folder node
            "children": [{ // bookmark node
                "dateAdded": 1425441500109,
                "id": "5",
                "index": 0,
                "parentId": "1",
                "title": "Inbox - krazykylep@gmail.com - Gmail",
                "url": "https://mail.google.com/mail/u/0/?pli=1#inbox"
            }],
            "dateAdded": 1398133602091,
            "dateGroupModified": 1503811743189,
            "id": "1",
            "index": 0,
            "parentId": "0",
            "title": "Bookmarks bar"
        }, { // folder node
            "children": [],
            "dateAdded": 1398133602091,
            "id": "2",
            "index": 1,
            "parentId": "0",
            "title": "Other bookmarks"
        }],
        "dateAdded": 1503694544274,
        "id": "0",
        "title": ""
    }
    */
}

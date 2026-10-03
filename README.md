# RoboFables

RoboFables is a block-coding web app for classroom robots. Kids drag blocks, watch a preview of the arm, and press **Run** to move a joint over a USB wireless dongle.

RoboFables is an open-source block-coding app for classroom robots, written as an independent alternative to Fable Blockly.

One codebase, two ways to run the same page. The UI is plain HTML, CSS, and JavaScript on top of [Google Blockly](https://github.com/google/blockly) (Apache 2.0), vendored offline under `vendor/blockly/`. There is no vendor SDK and no cloud account. Lights and wheels stay off.

Preview works with no dongle. **Run** needs the dongle and a robot on the **same colour channel**.

## Zip edition (Windows, no Python install)

For a kid on Windows: unzip **RoboFables-win64.zip** and double-click **Start-RoboFables.bat**.

That starts the bundled Python and opens **[http://127.0.0.1:8765/](http://127.0.0.1:8765/)** in the browser. The kid does not install Python, pip, or a driver package.

The zip is a build output (`dist/`, not committed). On a machine with network, from this folder:

```bash
python3 scripts/build-win-zip.py
```

The script downloads the official Windows embeddable CPython 3.12 zip (64-bit) from [python.org](https://www.python.org/ftp/python/) and a pyserial wheel from PyPI. It packs those with `bridge_server.py` and these web files into `dist/RoboFables-win64.zip`.

## Web edition (no local Python)

The web build is these same files, served by any static host. Open the page in **Chrome** or **Edge**. Press **Ports**, pick the USB dongle, and click **Allow**. The page then talks to the dongle with the Web Serial API (`navigator.serial`): ping, discover, and joint position — the same bytes as the Python bridge. Lights and wheels are not sent.

**Firefox and Safari** cannot do this. The page shows a short message and asks for Chrome or Edge. Web Serial also needs `https` or `localhost` (opening the HTML file directly will not see the dongle).

A local try is still the bridge below, **or** Web Serial if you open the page in Chrome or Edge without the bridge.

## Run the bridge yourself

Use this when you are not using the zip and not using Web Serial. From this folder:

```bash
python3 -m venv .venv
```

Activate the virtual environment:

```bash
# macOS / Linux
source .venv/bin/activate

# Windows (Command Prompt)
.venv\Scripts\activate

# Windows (PowerShell)
.venv\Scripts\Activate.ps1
```

Then:

```bash
python3 -m pip install -r requirements.txt
python3 bridge_server.py
```

`requirements.txt` is only `pyserial`. The bridge listens on **127.0.0.1** port **8765** and also serves this web app.

Open **[http://127.0.0.1:8765/](http://127.0.0.1:8765/)**.

You should see:

```text
RoboFables bridge http://127.0.0.1:8765/
Gates: LED=OFF  wheels=OFF  joint and ping=ON
```

Stop the bridge with Ctrl+C.

You need Python 3.11 or newer for this path. Windows, macOS, or Linux. No Shape SDK.

## For teachers

1. Plug in the USB dongle. Turn the joint robot on. Set both to the same colour.
2. Start RoboFables: double-click **Start-RoboFables.bat** (zip), run `bridge_server.py` (above), or open the static page in Chrome or Edge (Web Serial).
3. Choose **Device**. **Explore** is the arm. **Go** shows drive blocks (those stay off — see below).
4. Choose **Level** next to Device. **Simple** (the default) keeps a small set for the youngest — arm angle or the simplest drive stubs, wait, safe stop, repeat, and forever — and hides If, comparisons, My blocks, and See the code. **Full** restores the complete toolbox you already know (Motion, Loops, If, My blocks, See the code), and the choice is saved in the browser.
5. Press **Ports**. On the bridge, pick the dongle (a star marks the likely one). On Web Serial, click **Allow** for the dongle. Then press **Connect**.
6. The chip should say **Connected**. The robot list uses the name from the sticker when the dongle reports one.
7. Drag blocks from **Motion**, **Loops**, and **If**. The storyboard strip shows the top chain from left to right.
8. Press **Preview** to animate the drawing on screen. Nothing is sent over USB.
9. Press **Run** to send arm moves. **Safe stop** returns the arm to the centre.
10. **Forever** keeps going until you press **Stop**. Stop ends the loop; it does not need a special block.
11. Name the project and press **Save**. **Download project** writes a JSON file. **Upload project** reads one back. Projects live in the browser (`localStorage`) until you download them.

**Create block** (under **My blocks**) lets a class save a stack and reuse it. Type a name, put blocks inside, then press **Save as block**.

**See the code** opens a Python reading of the same stacks. It is a view for curious kids, not a second program you have to run.

## What is turned off on purpose

Lights (**LED**) and wheel / spin commands are **gated off** in `js/gates.js`, in `js/webserial.js` (those commands are never sent), and again on the bridge (`/api/led`, `/api/spin`, and `/api/wheels` answer 403).

- On **Explore**, the toolbox is the arm: set X, set X and Y, wait, and safe stop.
- On **Go**, drive, turn, and stop-wheels blocks are visible so the idea is there, but running them does not move wheels. The app says so in plain language.

Joint moves, dongle ping, and discover stay on.

## Projects

A downloaded project is JSON (`format: "robolab-project"`). It stores the Blockly workspace, the device mode (Explore or Go), and any custom blocks that program uses. Nothing is uploaded to a server.

## Contributing

This is a public repository. Pull requests are welcome.

The maintainer reviews and merges small fixes. Larger behaviour changes get a human decision before they land.

Please keep the LED and wheel gates closed unless a change is explicitly about opening them. Keep user-visible text in English. The Web Serial bytes live in `js/webserial.js` and must stay the same as `src/robofables_link/hub.py`.

## License

RoboFables itself is [MIT](LICENSE) — Copyright (c) 2026 Alex Mærsk.

Google Blockly is Apache 2.0. See [THIRD_PARTY.md](THIRD_PARTY.md).

The Windows zip, when built, also contains embeddable CPython (PSF License) and pyserial (BSD). See `BUNDLED-PYTHON.txt` inside that zip. Those are not committed to this repository.

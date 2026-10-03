# RoboFables

RoboFables is a block-coding web app for classroom robots. Kids drag blocks, watch a preview of the arm, and press **Run** to move a joint over a USB wireless dongle.

RoboFables is an open-source block-coding app for classroom robots, written as an independent alternative to Fable Blockly.

The page is plain HTML, CSS, and JavaScript on top of [Google Blockly](https://github.com/google/blockly) (Apache 2.0), vendored offline under `vendor/blockly/`. A small Python bridge on your computer talks to the USB dongle. There is no vendor SDK, no cloud account, and no install beyond Python.

## What you need

- Windows, macOS, or Linux
- [Chrome](https://www.google.com/chrome/) or [Edge](https://www.microsoft.com/edge)
- Python 3.11 or newer
- A USB wireless dongle and a compatible joint robot on the **same colour channel**
- No Shape SDK

Preview works with no dongle at all. **Run** needs the dongle, the bridge, and a robot that answers.

## Run it locally

From this folder:

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

`requirements.txt` is only `pyserial`. The bridge listens on **127.0.0.1** port **8765** and also serves the web app.

Open **[http://127.0.0.1:8765/](http://127.0.0.1:8765/)**.

You should see:

```text
RoboFables bridge http://127.0.0.1:8765/
Gates: LED=OFF  wheels=OFF  joint and ping=ON
```

Stop the bridge with Ctrl+C.

Opening the HTML file directly, or using `python3 -m http.server`, loads the page but **not** the USB API. Use `bridge_server.py` when you want the robot to move.

## For teachers

1. Plug in the USB dongle. Turn the joint robot on. Set both to the same colour.
2. Start the bridge (commands above) and open the page in Chrome or Edge.
3. Choose **Device**. **Explore** is the arm. **Go** shows drive blocks (those stay off — see below).
4. Press **Ports**, pick the dongle (a star marks the likely one), then **Connect**.
5. The chip should say **Connected**. The robot list uses the name from the sticker when the dongle reports one.
6. Drag blocks from **Motion**, **Loops**, and **If**. The storyboard strip shows the top chain from left to right.
7. Press **Preview** to animate the drawing on screen. Nothing is sent over USB.
8. Press **Run** to send arm moves. **Safe stop** returns the arm to the centre.
9. **Forever** keeps going until you press **Stop**. Stop ends the loop; it does not need a special block.
10. Name the project and press **Save**. **Download project** writes a JSON file. **Upload project** reads one back. Projects live in the browser (`localStorage`) until you download them.

**Create block** (under **My blocks**) lets a class save a stack and reuse it. Type a name, put blocks inside, then press **Save as block**.

**See the code** opens a Python reading of the same stacks. It is a view for curious kids, not a second program you have to run.

## What is turned off on purpose

Lights (**LED**) and wheel / spin commands are **gated off** in `js/gates.js` and again on the bridge (`/api/led`, `/api/spin`, and `/api/wheels` answer 403).

- On **Explore**, the toolbox is the arm: set X, set X and Y, wait, and safe stop.
- On **Go**, drive, turn, and stop-wheels blocks are visible so the idea is there, but running them does not move wheels. The app says so in plain language.

Joint moves, dongle ping, and discover stay on.

## Projects

A downloaded project is JSON (`format: "robolab-project"`). It stores the Blockly workspace, the device mode (Explore or Go), and any custom blocks that program uses. Nothing is uploaded to a server.

## Contributing

This is a public repository. Pull requests are welcome.

The maintainer reviews and merges small fixes. Larger behaviour changes get a human decision before they land.

Please keep the LED and wheel gates closed unless a change is explicitly about opening them. Keep user-visible text in English.

## License

RoboFables itself is [MIT](LICENSE) — Copyright (c) 2026 Alex Mærsk.

Google Blockly is Apache 2.0. See [THIRD_PARTY.md](THIRD_PARTY.md).

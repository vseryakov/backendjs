# The bkjs tool

The purpose of the `bkjs` shell script is to act as a helper tool in configuring and managing the backend environment
and as well to be used in operations on production systems. It is not required for the backend operations and provided as a convenience tool
which is used in the backend development and can be useful for others running or testing the backend.

Run `bkjs help` to see description of all available commands.

The tool is multi-command utility where the first argument is the command to be executed with optional additional arguments if needed.

On Linux, when started the bkjs tries to load and source the following global config files:

        /etc/conf.d/bkjs
        /etc/sysconfig/bkjs

Then it try to source all local config files:

        $BKJS_ENV/../etc/profile
        $BKJS_HOME/etc/profile
        $BKJS_ENV/../etc/profile.local
        $BKJS_HOME/etc/profile.local

Any of the following config files can redefine any environment variable thus pointing to the correct backend environment directory or
customize the running environment, these should be regular shell scripts using bash syntax.

To check all env variables inside bkjs just run the command `bkjs env`

The tool provides some simple functions to parse comamndline arguments,
the convention is that argument name must start with a single dash followed by a value.

- `get_arg(name, dflt)` - returns the value for the arg `name` or default value if specified
- `get_flag(name, dflt)` - returns 1 if there is a command lione arg with the `name` or default value
  Example:

      bkjs shell -log debug

- `concat_arg(name, value)` - returns concatenated value from the arg and provided value, to combine values from multiple sources
  Example:

      ssh=$(concat_arg -ssh $BKJS_SSH_ARGS)


- `get_json(file, name, dflt, realpath)` - returns a value from the json file, `name` can be path deep into object, `realpath` flag if nonempty will treat all values as paths and convert each into actual real path (this is used by the internal web bundler)
- `get_json_flat` - similar to get_json but property names are flattened for deep access
  Example:

      $(get_json package.json config.sync.path)
      $(get_json package.json name)

- `get_all_args(except)` - returns all args not present in the `except` list, this is to pass all arguments to other script, for command development
   Example:

      The script is called: `bkjs cmd1 -skip 1 -filter 2 -log 3`

      Your command handler process -skip but must pass all other args to another except -skip

      cmd1)
        skip=$(get_arg -skip)
        ...
        other_script $(get_all_args "-skip")
        ;;


## Extending bkjs tool

The utility is extended via external scripts that reside in the `tools/` folders.

When bkjs is running it treats the first arg as a command:

- `$BKJS_CMD` set to the whole comamnd

if no internal commands match it starts loading external scripts that match with `bkjs-PART1-*` where
PART1 is the first part of the command before first dash.

For example, when called:

    bkjs ec2-check-hostname

it will check the command in main bkjs cript, not found it will search for all files that
match `bkjs-ec2-*` in all known folders.

The file are loaded from following directories in this particular order:

- in the filder specified by the `-tools` command line argument
- $(pwd)/tools
- `$BKJS_TOOLS`,
- `BKJS_ENV/../tools`
- `$BKJS_HOME/tools`
- `$BKJS_DIR/tools`

`BKJS_DIR` always points to the backendjs installation directory.

`BLKJS_TOOLS` env variable may contain a list of directories separated by `spaces`, this variable or command line arg `-tools` is the way to add
custom commands to bkjs. `BKJS_TOOLS` var is usually set in one of the profile config files mentioned above.

Example of a typical bkjs command:

We need to set BKJS_TOOLS to point to our package(s), on Darwin add it to ~/.bkjs/etc/profile as

    BKJS_TOOLS="$HOME/src/node-pkg/tools"


Create a file `$HOME/tools/bkjs-super`

    #!/bin/sh

    case "$BKJS_CMD" in
      super)
       arg1=$(get_arg -arg1)
       arg2=$(get_arg -arg1 1)
       [ -z $arg1 ] && echo "-arg1 is required" && exit 1
       ...
       exit

      super-all)
       ...
       exit
       ;;

      help)
       echo ""
       echo "$0 super -arg1 ARG -arg2 ARG ..."
       echo "$0 super-all ...."
       ;;
    esac

Now calling `bkjs super` or `bkjs super-all` will use the new `$HOME/tools/bkjs-super` file.

# Web development notes

Then run the dev build script to produce web/js/bkjs.bundle.js and web/css/bkjs.bundle.css

    cd node_modules/backendjs && npm run devbuild

Now instead of including a bunch of .js or css files in the html pages it only needs /js/bkjs.bundle.js and /css/bkjs.bundle.css.

The bundle configuration is in the package.json file.

The list of files to be used in bundles is in the package.json under `config.bundles`.

To enable auto bundler in your project just add to the local config `~/.bkjs/etc/config.local` a list of directories to be
watched for changes. For example adding these lines to the local config will enable the watcher and bundle support

    watcher-web=web/js,web/css,$HOME/src/js,$HOME/src/css


The simple script below allows to build the bundle and refresh Chrome tab automatically, saves several clicks:

    #!/bin/sh
    bkjs bundle -dev -file $2
    [ "$?" != "0" ] && exit
    osascript -e "tell application \"Google Chrome\" to reload (tabs of window 1 whose URL contains \"$1\")"


To use it, call this script instead in the config.local:

    watcher-build=bundle.sh /website

NOTE: Because the rebuild happens while the watcher is running there are cases like the server is restarting or pulling a large update from the
repository when the bundle build may not be called or called too early. To force rebuild run the command:

    bkjs bundle -dev -all -force


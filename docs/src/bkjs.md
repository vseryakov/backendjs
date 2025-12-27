# The bkjs tool

The purpose of the **bkjs** shell script is to act as a helper tool in configuring and managing the backend environment
and as well to be used in operations on production systems. It is not required for the backend operations and provided as a convenience tool
which is used in the backend development and can be useful for others running or testing the backend.

Run **bkjs help** to see description of all available commands.

The tool is multi-command utility where the first argument is the command to be executed with optional additional arguments if needed.

On Linux, when started the bkjs tries to load and source the following global config files:

```shell
/etc/conf.d/bkjs
/etc/sysconfig/bkjs
```

Then it try to source all local config files:

```shell
$BKJS_ENV/../etc/profile
$BKJS_HOME/etc/profile
$BKJS_ENV/../etc/profile.local
$BKJS_HOME/etc/profile.local
```

Any of the following config files can redefine any environment variable thus pointing to the correct backend environment directory or
customize the running environment, these should be regular shell scripts using bash syntax.

To check all env variables inside bkjs just run the command **bkjs env**

The tool provides some simple functions to parse comamndline arguments,
the convention is that argument name must start with a single dash followed by a value.

- **get_arg(name, dflt)** - returns the value for the arg **name** or default value if specified
- **get_flag(name, dflt)** - returns 1 if there is a command lione arg with the **name** or default value
  Example:
  ```shell
  bkjs shell -log debug
  ```

- **concat_arg(name, value)** - returns concatenated value from the arg and provided value, to combine values from multiple sources
  Example:
  ```shell
  ssh=$(concat_arg -ssh $BKJS_SSH_ARGS)
  ```

- **get_json(file, name, dflt, realpath)** - returns a value from the json file, **name** can be path deep into object, **realpath** flag if nonempty will treat all values as paths and convert each into actual real path (this is used by the internal web bundler)
- **get_json_flat** - similar to get_json but property names are flattened for deep access
  Example:
  ```shell
  $(get_json package.json config.sync.path)
  $(get_json package.json name)
  ```
- **get_all_args(except)** - returns all args not present in the **except** list, this is to pass all arguments to other script, for command development
   Example:

      The script is called: **bkjs cmd1 -skip 1 -filter 2 -log 3**

      Your command handler process -skip but must pass all other args to another except -skip
    ```shell
    cmd1)
      skip=$(get_arg -skip)
      ...
      other_script $(get_all_args "-skip")
      ;;
    ```

## Extending bkjs tool

The utility is extended via external scripts that reside in the **tools/** folders.

When bkjs is running it treats the first arg as a command:

- **$BKJS_CMD** set to the whole comamnd

if no internal commands match it starts loading external scripts that match with **bkjs-PART1-*** where
PART1 is the first part of the command before first dash.

For example, when called:

```shell
bkjs ec2-check-hostname
```

it will check the command in main bkjs cript, not found it will search for all files that
match **bkjs-ec2-*** in all known folders.

The file are loaded from following directories in this particular order:

- in the filder specified by the **-tools** command line argument
- $(pwd)/tools
- **$BKJS_TOOLS**,
- **BKJS_ENV/../tools**
- **$BKJS_HOME/tools**
- **$BKJS_DIR/tools**

**BKJS_DIR** always points to the backendjs installation directory.

**BKJS_TOOLS** env variable may contain a list of directories separated by **spaces**, this variable or command line arg **-tools** is the way to add
custom commands to bkjs. **BKJS_TOOLS** var is usually set in one of the profile config files mentioned above.

Example of a typical bkjs command:

We need to set BKJS_TOOLS to point to our package(s), on Darwin add it to ~/.bkjs/etc/profile as

```shell
BKJS_TOOLS="$HOME/src/node-pkg/tools"
```

Create a file **$HOME/tools/bkjs-super**

```shell
#!/bin/sh

case "$BKJS_CMD" in
  super)
    arg1=$(get_arg -arg1)
    arg2=$(get_arg -arg1 1)
    [ -z $arg1 ] && echo "-arg1 is required" && exit 1
    ...
    exit
    ;;

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
```

Now calling **bkjs super** or **bkjs super-all** will use the new $HOME/tools/bkjs-super file.


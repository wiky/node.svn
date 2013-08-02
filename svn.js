var spawn = require('child_process').spawn;
var fs = require('fs');
var nodePath = require('path');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var promise = require('./lib/promise').promise;

/**
 *    [o] = svn standard method & finished
 *    [+] = not svn standard method, new add & finished
 *    [ ] = todo
 *    
 * [o] svn.add
 * [ ] svn.blame
 * [+] svn.choose
 * [ ] svn.cat
 * [o] svn.ci = svn.commit
 * [o] svn.cleanup
 * [ ] svn.cl = svn.changeList
 * [o] svn.co = svn.checkout
 * [ ] svn.cp = svn.copy
 * [ ] svn.di = svn.diff
 * [+] svn.type
 * [o] svn.info
 * [o] svn.ls = svn.list
 * [ ] svn.lock
 * [o] svn.log
 * [+] svn.queue
 * [ ] svn.revert
 * [ ] svn.rm = svn.remove = svn.del
 * [+] svn.run
 * [ ] svn.resolve
 * [o] svn.st = svn.status
 * [o] svn.sw = svn.switchTo
 * [ ] svn.unlock
 * [o] svn.up = svn.update
 */

/**
 * node svn command
 * @param  {Object|string} config config, when string, same as config.cwd
 * @param  {string} config.cwd Current work directory
 * @param  {string} [config.username]
 * @param  {string} [config.password]
 */
var SVN = function(config) {
    var _this = this;
    this.config = (typeof config === 'string') ? {
        cwd: config
    } : (config || {});
    if (!this.config.cwd) {
        throw new Error('[SVN Error] no cwd');
    }
    this.root = this.config.cwd || '';
};

util.inherits(SVN, EventEmitter);

var svn = SVN.prototype;

svn.add = function(path, callback) {
    return this.run(['add', nodePath.join(this.root, path)], function(err, text) {
        if (callback) {
            callback(err, helper.parseActions(text));
        }
    });
};

/**
 * svn co
 * @param  {string}   command  url[[ name] ARGS]
 * @param  {Function} callback
 */
svn.co = svn.checkout = function(command, callback, cwd) {
    var _this = this,
        args = [],
        options = command.split(/\s+/) || [],
        url = options.shift(),
        name = options[0];

    if (typeof callback === 'string') {
        cwd = callback;
        callback = null;
    }

    if (!name || name.substr(1, 1) === '-') {
        name = nodePath.basename(this.root);
        cwd = cwd || nodePath.dirname(this.root);
    } else {
        name = '';
    }

    args = ['checkout', url].concat(name ? [name] : []).concat(options);

    return this.run(args, function(err, text) {
        if (callback) {
            callback(err, helper.parseActions(text));
        }
    }, cwd);
};

svn.choose = function(url, files, callback) {
    files = [].concat(files);
    var _this = this,
        toExecFn = [],
        doExecFn = function(args) {
            var path = args.path.replace(/^\/|\/$/, '');
            if (args.way === 'co') {
                ret = _this.co([
                    url.replace(/\/$/, '') + (path ? '/' + path : ''),
                    path,
                    '--depth=empty'
                ].join(' '));
            } else {
                ret = _this.up(path);
            }
            return ret;
        };

    toExecFn.push((function(args) {
        return function(err) {
            return doExecFn(args);
        };
    })({
        path: '',
        way: 'co'
    }));
    files.forEach(function(file) {
        var arr = file.replace(/^\/|\/$/, '').replace(/\/?[^\/]+\/?/g, '$`$&,').split(',');
        arr.pop();
        arr.forEach(function(path, i) {
            var way = 'co',
                cwd = '';
            if (i === arr.length - 1) {
                way = 'up';
                cwd = nodePath.join(_this.root, arr[0]);
            }
            toExecFn.push((function(args) {
                return function(err) {
                    return doExecFn(args);
                };
            })({
                path: path,
                way: way,
                cwd: cwd
            }));
        });
    });
    this.queue(toExecFn, function() {
        if (callback) {
            callback.call(_this);
        }
    });
};


svn.up = svn.update = function(command, callback) {
    if (typeof command === 'function') {
        callback = command;
        command = null;
    }

    var _this = this,
        args = ['update'].concat(command ? [command] : []);

    if (!command || (command && command.indexOf('--accept') === -1)) {
        args = args.concat(['--accept', 'postpone']);
    }
    return this.run(args, function(err, text) {
        if (callback) {
            callback(err, helper.parseActions(text));
        }
    });
};

svn.sw = svn.switchTo = function(url, callback) {
    var _this = this;
    return this.run(['switch', url, this.root, '--accept', 'postpone'], callback);
};

svn.ls = svn.list = function(path, callback) {
    this.run(['list', path], function(err, info) {
        var data = null;
        if (!err) {
            data = info.replace(/\s*\r\n\s*$/, '').split(/\s*\r\n\s*/);
        }
        (data || []).forEach(function(value, i) {
            var type = /\/$/.test(value) ? 'directory' : 'file';
            data[i] = {
                name: value.replace(/\/$/, ''),
                type: type
            };
        });
        if (callback) {
            callback(err, data);
        }
    });
};

svn.info = function(command, callback) {
    if (typeof command === 'function') {
        callback = command;
        command = '';
    }
    var _this = this,
        args = ['info'].concat(command.split(/\s+/));

    return this.run(args, function(err, text) {
        if (!err) {
            callback(null, helper.parseInfo(text));
        } else {
            callback(err, null);
        }
    });
};

svn.type = function(url, callback) {
    var _this = this;
    this.run(['info', url], function(err, info) {
        var data, type = '';
        if (!err) {
            data = helper.parseInfo(info);
            type = data.nodekind;
        }
        if (callback) {
            callback(err, type);
        }
    });
};

svn.log = function(command, callback) {
    command = command || '';
    if (typeof command === 'function') {
        callback = command;
        command = '';
    }
    var _this = this,
        args = ['log'].concat(command.split(/\s+/)).concat(['-v']);
    return this.run(args, function(err, text) {
        if (!err) {
            _this.info(function(err, info) {
                callback(null, helper.parseLog(text, info));
            });
        } else {
            callback(err, null);
        }
    });
};

svn.queue = function(queue, callback) {
    var _this = this;
    promise.chain(queue).then(function() {
        if (callback) {
            callback.apply(_this, arguments);
        }
    });
};

svn.st = svn.status = function(callback) {
    var _this = this;
    return this.run(['status', this.root], function(err, text) {
        if (!err) {
            callback(null, helper.parseStatus(text));
        } else {
            callback(err, null);
        }
    });
};

svn.ci = svn.commit = function(files, message, callback) {
    var _this = this,
        args = ['ci', '-m', '"' + message + '"'].concat([].concat(files).map(function(file) {
            return file && nodePath.join(_this.root, file);
        }));
    return this.run(args, callback);
};


svn.cleanup = function(path, callback) {
    if (typeof path === 'function') {
        callback = path;
        path = '';
    }
    return this.run(['cleanup', path], callback);
};

svn.run = function(args, callback, cwd) {
    var _this = this,
        config = this.config,
        text = '',
        err = '',
        cmd = 'svn',
        proc = spawn(cmd, args, {
            cwd: cwd || this.root
        });

    var p = new promise.Promise();

    args = args.concat(['--non-interactive', '--trust-server-cert']);

    if (config && config.username && config.password) {
        args = args.concat(['--username', config.username, '--password', config.password]);
    }

    this.emit('cmd', proc, cmd, args);

    console.info('[SVN INFO]', cwd || this.root, '>', cmd, args.join(' '));

    proc.stdout.on('data', function(data) {
        text += data;
    });

    proc.stderr.on('data', function(data) {
        data = String(data);
        console.error('[SVN ERROR]', data);
    });

    proc.on('close', function(code) {
        if (callback) {
            callback(err, text);
        }
        p.done(err, text);
    });

    this.proc = proc;

    return p;
};


var helper = {
    parseActions: function(text) {
        var array = text.replace(/\r\n/g, '\n').split('\n'),
            actions = [];
        array.forEach(function(line) {
            var matched = line.match(/\s*([ADUCGEM]|Restored)\s+([^\s]*)\s*/);
            if (matched && matched[1] && matched[2]) {
                actions.push({
                    status: matched[1],
                    path: matched[2].replace(/\'/g, '')
                });
            }
        });
        /*
         * A Added
         * D Deleted
         * U Updated
         * C Conflict
         * G Merged
         * E Exists
         */
        return actions;
    },
    parseInfo: function(text) {
        var array = text.replace(/\r\n/g, '\n').split('\n'),
            info = {};
        array.forEach(function(line) {
            var firstColon = line.indexOf(':');
            info[line.substring(0, firstColon).replace(/\s*/g, '').toLowerCase()] = line.substring(firstColon + 1).trim();
        });
        return info;
    },
    parseStatus: function(text) {
        var split = text.replace(/\r\n/g, '\n').split('\n'),
            changes = [],
            line;

        for (var i = 0; i < split.length; i += 1) {
            line = split[i];
            if (line.trim().length > 1) {
                changes.push({
                    status: line[0],
                    path: nodePath.resolve(line.substr(7).trim()).replace(this.root, '')
                });
            }
        }
        return changes;
    },
    parseLog: function(text, info) {
        var array = text.replace(/\r\n/g, '\n').split(/-{2}/),
            logList = [],
            item,
            i;

        array.forEach(function(a) {
            if (!a) {
                return;
            }
            item = helper.parseLogEntry(a, info);
            if (item) {
                logList.push(item);
            }
        });
        return logList;
    },
    parseLogEntry: function(logText, info) {
        var array = logText.split(/\n/),
            log = {},
            i = 0,
            header = array[0],
            changeString,
            changeArray,
            relativeUrl = info.url.replace(info.repositoryroot, '');

        while (header === '') {
            header = array[i += 1];
        }

        if (!header) {
            return null;
        }

        header = header.split(/\s*\|\s*/);

        log.revision = header[0].substr(1);
        log.author = header[1];
        log.date = new Date(header[2]);
        log.files = [];
        log.changes = [];
        log.info = info;

        for (i = i + 2; i < array.length; i += 1) {
            changeString = array[i].trim();
            if (changeString === '') {
                break;
            }
            changeArray = changeString.split(/\s+/);
            if (changeArray[1].match(relativeUrl)) {
                log.files.push({
                    path: changeArray[1].replace(relativeUrl, ''),
                    status: changeArray[0]
                });
            }
            log.changes.push({
                path: changeArray[1],
                status: changeArray[0]
            });
        }

        log.message = '';

        for (i += 1; i < array.length - 1; i += 1) {
            log.message += array[i];
            if (i !== array.length - 2) {
                log.message += '\n';
            }
        }
        return log;
    }
};

module.exports = function(config, callback) {
    return new SVN(config, callback);
};
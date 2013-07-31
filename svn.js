/*jslint node: true */
'use strict';

var spawn = require('child_process').spawn;
var path = require('path');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
//var promise = require('./promise');

/**
 * svn.co = svn.checkout -- finished
 * svn.up = svn.update -- finished
 * svn.sw = svn.switchTo -- finished
 * svn.ls = svn.list -- finished
 * svn.info - finished
 * svn.rm = svn.remove -- todo
 * svn.st = svn.status -- ok
 * svn.add  -- ok
 * svn.cleanup -- ok
 * svn.revert -- todo
 * svn.getType -- get svn type
 * svn.run
 */

var SVN = function(config, callback) {
    var _this = this;
    this.config = (typeof config === 'string') ? {
        path: config
    } : (config || {});
    // TODO: check current work directory is exist or not.
    this.root = this.config.path || '';
    this.run('svn', ['--version'], function(err, text) {
        if (!err) {
            _this.refreshInfoCache('_info', callback);
        } else {
            callback(err, null);
        }
    });
};

util.inherits(SVN, EventEmitter);

var svn = SVN.prototype;

svn.co = svn.checkout = function(options, callback) {
    var _this = this,
        args = [],
        matched;
    if (typeof options === 'string') {
        options = {
            url: options
        };
    }
    if (!options.url) {
        throw new Error('[svn checkout error] no url');
    }
    args = ['checkout', options.url];
    if (!options.name) {
        matched = options.url.match(/([^\/]+)\/?$/);
        options.name = matched && matched[1];
    } else {
        args.push(options.name);
    }
    if (options.depth) {
        args.concat(['--depth', options.depth]);
    }
    this.run('svn', args, function(err, info) {
        if (!err) {
            _this.root = path.join(_this.root, options.name);
        }
        if (callback) {
            callback(err, info);
        }
    });
};

svn.choose = function (options, callback) {
    if (!options.url) {
        throw new Error('[svn choose error] no url');
    }
    var files = [].concat(options.files);
    files.forEach(function (file) {

    });
};

// options.path(directory/file)
// options.revision
svn.up = svn.update = function(options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = null;
    }

    var _this = this,
        args = ['update', (options && options.path) || this.root];

    if (options && options.revision !== undefined) {
        args = args.concat(['-r', options.revision]);
    }

    args = args.concat(['--accept', 'postpone']);
    return this.run('svn', args, function(err, text) {
        if (!err) {
            // Update the info if we successfully updated
            _this.refreshInfoCache('_info', function(err, info) {
                if (callback) {
                    callback(null, info);
                }
            });
        } else {
            if (callback) {
                callback(err);
            }
        }
    });
};

svn.sw = svn.switchTo = function(url, callback) {
    var _this = this;
    return this.run('svn', ['switch', url, this.root, '--accept', 'postpone'], function(err, text) {
        if (!err) {
            // Update the info if we successfully updated
            _this.refreshInfoCache('_info', function(err, info) {
                callback(null, info);
            });
        } else {
            window.confirm(err + text);
            callback(err, null);
        }
    });
};

svn.ls = svn.list = function (path, callback) {
    this.run('svn', ['list', this.root + path], function (err, info) {
        var data = null;
        if (!err) {
            data = info.replace(/\s*\r\n\s*$/, '').split(/\s*\r\n\s*/);
        }
        (data||[]).forEach(function (value, i) {
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

// TODO: this function really necessary, all I am saving is the scope[...] call?
svn.refreshInfoCache = function(infoCacheName, callback, revision) {
    var scope = this;
    this.info(function(err, info) {
        scope[infoCacheName] = info;
        if (callback) {
            callback(err, info);
        }
    }, revision);
};

svn.isUpToDate = function(callback) {
    var _this = this;
    _this.refreshInfoCache('_info', function(err, info) {
        if (!err) {
            _this.refreshInfoCache('_headInfo', function(headErr, headInfo) {
                callback(!headErr && parseInt(info.revision, 10) >= parseInt(headInfo.revision, 10));
            }, 'HEAD');
        } else {
            callback(false);
        }
    });
};

svn.info = function(revision, callback) {
    var _this = this,
        args = ['info', this.root];

    if (typeof revision === 'function') {
        callback = revision;
        revision = '';
    }

    if (revision) {
        args = args.concat(['-r', revision]);
    }

    return this.run('svn', args, function(err, text) {
        if (!err) {
            callback(null, _this._parseInfo(text));
        } else {
            callback(err, null);
        }
    });
};

svn.getType = function (url, callback) {
    var _this = this;
    this.run('svn', ['info', url], function (err, info) {
        var data, type = '';
        if (!err) {
            data = _this._parseInfo(info);
            type = data.nodekind;
        }
        if (callback) {
            callback(err, type);
        }
    });
};

svn.log = function(path, limit, callback) {
    var _this = this;
    return this.run('svn', ['log', path ? this._info.url + path.replace(/\\/g, '/') : this._info.url, '-v', '-l', limit || 25, '-r', 'HEAD:1', '--incremental'], function(err, text) {
        if (!err) {
            callback(null, _this._parseLog(text));
        } else {
            callback(err, null);
        }
    });
};

svn.revert = function (file, callback) {

};

svn.revertLocal = function(file, callback) {
    return this.run('svn', ['revert', this.root + file], callback);
};

svn.revertRevision = function(file, rev, callback) {
    return this.run('svn', ['merge', '-c', '-' + rev, this._info.url + file.replace(/\\/g, '/'), '--accept', 'postpone'], callback);
};

svn.st = svn.status = function(callback) {
    var _this = this;
    return this.run('svn', ['status', this.root], function(err, text) {
        if (!err) {
            callback(null, _this._parseStatus(text));
        } else {
            callback(err, null);
        }
    });
};

svn.ci = svn.commit = function(options, callback) {
    var _this = this,
        args = ['commit', '-m', options.message].concat(options.files.map(function(file) {
            return _this.root + file;
        }));
    return this.run('svn', args, callback);
};

svn.add = function(path, callback) {
    return this.run('svn', ['add', this.root + path], callback);
};

svn.cleanup = function(path, callback) {
    return this.run('svn', ['cleanup', this.root + path], callback);
};

svn.run = function(cmd, args, callback) {
    var _this = this,
        text = '',
        err = '',
        proc = spawn(cmd, args, {
            cwd: this.root
        });

    if (cmd === 'svn') {
        args = args.concat(['--non-interactive', '--trust-server-cert']);
    }

    if (cmd === 'svn' && this.config.username && this.config.password) {
        args = args.concat(['--username', this.config.username, '--password', this.config.password]);
    }

    this.emit('cmd', proc, cmd, args);

    console.warn('Running cmd: ', cmd, args.join(' '));

    proc.stdout.on('data', function(data) {
        text += data;
    });

    proc.stderr.on('data', function(data) {
        data = String(data);

        //ssh warning, ignore
        if (data.indexOf('Killed by signal 15.') === -1) {
            err += data;
            // console.error(data);
        }
    });

    proc.on('close', function(code) {
        if (callback) {
            callback(err, text);
        }
    });

    return proc;
};

svn._parseLogEntry = function(logText) {
    var array = logText.split('\n'),
        log = {},
        i = 0,
        header = array[0],
        changeString,
        relativeUrl = this._info.url.replace(this._info.repositoryroot, '');

    while (header === '') {
        header = array[i += 1];
    }

    header = header.split(' | ');

    log.revision = header[0].substr(1);
    log.author = header[1];
    log.date = new Date(header[2]);
    log.changes = [];

    for (i = i + 2; i < array.length; i += 1) {
        changeString = array[i].trim();
        if (changeString === '') {
            break;
        }
        log.changes.push({
            path: path.normalize(changeString.substr(1).trim().replace(relativeUrl, '')),
            status: changeString.substr(0, 1)
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
};

svn._parseInfo = function(text) {
    var array = text.replace(/\r\n/g, '\n').split('\n'),
        info = {};
    array.forEach(function(line) {
        var firstColon = line.indexOf(':');
        info[line.substring(0, firstColon).replace(/\s*/g, '').toLowerCase()] = line.substring(firstColon + 1).trim();
    });
    return info;
};


svn._parseLog = function(text) {
    var array = text.replace(/\r\n/g, '\n').split('------------------------------------------------------------------------'),
        logList = [],
        item,
        i;

    for (i = 1; i < array.length; i += 1) {
        item = this._parseLogEntry(array[i]);
        if (item) {
            logList.push(item);
        }
    }

    return logList;
};

svn._parseStatus = function(text) {
    var split = text.replace(/\r\n/g, '\n').split('\n'),
        changes = [],
        line;

    for (var i = 0; i < split.length; i += 1) {
        line = split[i];
        if (line.trim().length > 1) {
            changes.push({
                status: line[0],
                path: path.resolve(line.substr(7).trim()).replace(this.root, '')
            });
        }
    }
    return changes;
};

module.exports = function(config, callback) {
    return new SVN(config, callback);
};


var mysvn = new SVN({
    path: 'D:\\mkwork\\test\\test'
}, function(err, info) {
    mysvn.st(function(){
        console.log(arguments);
    })

    // mysvn.co('http://svn.alibaba-inc.com/repos/ali_intl_share/intl-style/branches/20130726_283323_1/deploy/htdocs/js/5v/esite/js/ae-combo.js', function() {
    //     console.log('arguments', arguments);
    // });
});

/**
 * Created by ddavis on 11/13/15.
 */
var http = require('http-request');
var $q = require('q');
var fs = require('fs');
var mkdirp = require('mkdirp');
var del = require('del');
var classNames = require(__dirname+'/classnames.json');
var classNameEx = /^\/(\w*)\//;
var actionNameEx = /\/([\w*|-]*)$/;
var actionNameDashEx = /-(\w)/g;
var gulp = require('gulp');
var wrap = require('gulp-wrap');
var rename = require("gulp-rename");

require('string.prototype.endswith');

function isUndefinedOrNull(obj) {
    return obj==null||obj==undefined;
}

function jsServiceName(action) {
    var name = null;
    var serviceName = action.path.match(classNameEx);
    if(serviceName) {
        if(serviceName instanceof Array&&serviceName.length>1) {
            serviceName = serviceName[serviceName.length-1];
        }
        name = classNames[name]||serviceName[0].toUpperCase()+serviceName.substring(1);
        name = name+'Service';
    }
    return name;
}

function polyMorphMethodName(name,methods) {
    var temp = name;
    var iter = 1;
    while(methods[temp]) {
        temp = name+'_'+iter;
        iter+=1;
    }
    return temp;
}

function jsMethodName(action,methods) {
    var name = action.path.match(actionNameEx);
    if(name) {
        if(name instanceof Array&&name.length>1) {
            name = name[name.length-1];
        }
        name = name.replace(actionNameDashEx,function uppercase(s){
            return s[1].toUpperCase();
        });
        name = polyMorphMethodName(name,methods);
    }
    return name;
}

function contextActionPath(action,context) {
    var path = action.path;
    if(path&&context!=='') {
        path = '/'+context+'.'+path.substring(1);
    }
    return path;
}

function getDirForHost(server) {
    return server.replace('://','.').replace(':','.');
}

function Connection(options) {
    this.options = {};
    this.options.server = options.server||'http://localhost:8080';
    this.options.contexts = {'':'Liferay'};
    this.options.root = __dirname+'/services/'+getDirForHost(this.options.server);
    this.options.actionsDir = '/json';
    this.options.jsDir = '/js';
    this.options.version = options.version||'62';
    this.options.templatesDir = __dirname+'/templates';
    this.options.filter = {'':''};
    if(options.contexts) {
        for (var key in options.contexts) { this.options.contexts[key] = options.contexts[key]; }
    }
}


Connection.prototype.discover = function(context) {
    var self = this;
    var deferred = $q.defer();
    var filter = this.options.filter[context]||'';
    if(filter!=='') {
        filter = '/'+filter;
    }
    var contextPath = context;
    if(contextPath!=='') {
        contextPath = '/'+contextPath;
    }
    http.get({url:this.options.server+contextPath+'/api/jsonws?discover='+filter+'/*'},function(err,res) {
        if(err) {
            console.error(err);
            return deferred.reject(err);
        }
        var obj = JSON.parse(isUndefinedOrNull(res.buffer)?{}:res.buffer.toString());
        var actions = obj.actions;
        var actionsDir = self.options.root+self.options.actionsDir+'/'+self.options.contexts[context];
        mkdirp.sync(self.options.root+self.options.actionsDir);
        var serviceMethods = {name:'',version:self.options.version,module:self.options.moduleName,methods:{}};
        for(var i =0; i<actions.length;i++) {
            var action = actions[i];
            var serviceName = jsServiceName(action);
            if(serviceMethods.name !== serviceName) {
                if(Object.keys(serviceMethods.methods).length) {
                    fs.writeFileSync(actionsDir+serviceMethods.name+'.json',JSON.stringify(serviceMethods));
                }
                serviceMethods = {name:serviceName,version:self.options.version,module:self.options.moduleName,methods:{}};
            }
            var actionName = jsMethodName(action,serviceMethods.methods);
            var actionPath = contextActionPath(action,context);
            serviceMethods.methods[actionName] = {
                serviceName:serviceName,
                method:action.method,
                path:actionPath,
                parameters:action.parameters,
                actionName:actionName
            };
        }
        if(Object.keys(serviceMethods.methods).length) {
            fs.writeFileSync(actionsDir+serviceMethods.name+'.json',JSON.stringify(serviceMethods));
        }
        deferred.resolve();
    });
    return deferred.promise;
};

Connection.prototype.generate = function() {
    var self = this;
    var deferred = $q.defer();
    del.sync(self.options.root+'/*');
    var contexts = Object.keys(self.options.contexts);
    var contextPromises = [];
    for(var i = 0; i<contexts.length; i++) {
         contextPromises.push(self.discover(contexts[i]));
    }
    $q.all(contextPromises).then(function() {
        return gulp.src(self.options.root+self.options.actionsDir+'/*.json')
            .pipe(wrap({src:self.options.templatesDir+'/service.txt'}))
            .on('error',function(err) {
                console.error(err);
                deferred.reject(err);
            })
            .pipe(rename(function(path) {
                path.extname = '.js';
            }))
            .pipe(gulp.dest(self.options.root+self.options.jsDir))
            .on('finish',function() {
                deferred.resolve(self);
            })
            .on('error',function(err) {
                console.error(err);
                return deferred.reject(err);
            });
    },function(err) {
        return deferred.reject(err);
    });
    return deferred.promise;
};

Connection.prototype.require = function(serviceName) {
    return require(this.options.root+this.options.jsDir+'/'+serviceName+'.js')(this);
};

Connection.prototype.AuthenticationType = {
    BASIC: 'basic',
    DIGEST: 'digest'
};

Connection.prototype.invoke = function(ctx,command) {
    var url = this.options.server;
    if(url.endsWith('/')) {
        url = url + 'api/jsonws/invoke';
    } else {
        url = url + '/api/jsonws/invoke';
    }
    var request = {
        url: url,
        reqBody: new Buffer(JSON.stringify([command])),
        headers: {
            'content-type': 'application/json'
        }
    };
    if(ctx.authenticationType) {
        if(ctx.authenticationType === this.AuthenticationType.BASIC) {
            request.auth = {
                type: 'basic',
                username: ctx.username,
                password: ctx.credentials
            }
        }
    }
    var deferred = $q.defer();
    http.post(request,function(err,res) {
        if(err) {
            deferred.reject(err);
        } else {
            var value = JSON.parse(res.buffer.toString());
            if(value) {
                if(Array.isArray(value)) {
                    deferred.resolve(value.length>0?value[0]:{});
                } else {
                    deferred.reject(value);
                }
            } else {
                deferred.reject(new Exception("Empty Body"));
            }
        }
    });
    return deferred.promise;
};

Connection.prototype.signin = function(authentication) {
    if(authentication) {
        var ctx = {};
        ctx.authenticationType = authentication.authenticationType;
        ctx.username = authentication.username;
        ctx.credentials = authentication.credentials;
        var deferred = $q.defer();
        var self = this;
        self.require('LiferayGroupService').getUserSites(ctx).then(function(resp){
            var site = resp[0];
            self.require('LiferayUserService').getUserByEmailAddress(ctx,site.companyId,ctx.username)
                .then(function(resp) {
                    ctx.user = resp;
                    deferred.resolve(ctx);
                },function(err) {
                    deferred.reject(err);
                });
        },function(err){
            deferred.reject(err);
        });
        return deferred.promise;
    }
};

module.exports = function(options) {
    var connection = new Connection(options);
    return connection.generate();
};
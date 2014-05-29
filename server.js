var express = require('express');
var path = require('path');
var fs = require('fs');
var crypto = require('crypto');
var request = require('request');
var cheerio = require('cheerio');
var async = require('async');
var app = express();
var asset_dir = __dirname + '/assets/';

var config = require('./config.json');

var getTimeString = function() {
    var current_time = new Date();
    var hours = current_time.getHours();
    var minutes = current_time.getMinutes();
    var seconds = current_time.getSeconds();
    if (hours < 10) {
        hours = "0" + hours
    }
    if (minutes < 10) {
        minutes = "0" + minutes
    }
    if (seconds < 10) {
        seconds = "0" + seconds
    }
    return hours + ":" + minutes + ":" + seconds
};

var getBasename = function(str) {
    return str.substring(str.lastIndexOf('/') + 1);
};

var mkdirp = function(real_path, mode) {
    var path_from_root = real_path.split(asset_dir)[1],
        path_array = path_from_root.split(path.sep),
        create_path = asset_dir;
    for(var i=0, path_count=path_array.length;i<path_count;i++) {
        segment = path_array[i];
        create_path = path.resolve(create_path, segment);
        if(!fs.existsSync(create_path)) {
            try {
                fs.mkdirSync(create_path, mode);
            } catch(e) {
                return false;
            }
            console.log(getTimeString() + " " + 'mkdir: ' + create_path);
        }
    }
    return true;
}

var updateAsset = function(url, asset_path, callback) {
    request(url).pipe(fs.createWriteStream(asset_path + '.tmp')).on('close', function() {
        fs.renameSync(asset_path + '.tmp', asset_path);
        console.log(getTimeString() + " " + 'writeAsset: ' + asset_path);
        callback();
    }).on('error', callback);
};

var writeAsset = function(url, asset_path, callback) {
    var parent_path = path.dirname(asset_path);
    if(fs.existsSync(parent_path) || mkdirp(parent_path, 0750)) {
        if(fs.existsSync(asset_path)) {
            var stream = fs.ReadStream(asset_path);
            var digest = crypto.createHash('md5');
            stream.on('data', function(data) { digest.update(data); });
            stream.on('error', function() { updateAsset(url, asset_path, callback); });
            stream.on('end', function() {
                var md5sum = digest.digest('hex');
                var file_path = url.split(config.host)[1];
                var md5_url = config.host + '/getmd5?file_path=' + file_path;
                request(md5_url, function(error, response, data) {
                    if(!error) {
                        var data = JSON.parse(data);
                        if(data.code == 200 && data.md5sum == md5sum) {
                            console.log(getTimeString() + " " + getBasename(file_path) + " is already up to date");
                            return;
                        }
                    }
                    return updateAsset(url, asset_path, callback);
                });
            });
        }
        else {
            return updateAsset(url, asset_path, callback);
        }
        return callback();
    }
    callback('Could not load asset directory ' + parent_path + ' please check permissions.');
};

var synchronize = function() {
    var config_url = config.host + '/playerlookup?player_id=' + config.playerID;

    request(config_url, function(error, response, html) {
        if(!error) {
            var remote_config = JSON.parse(html);
            if(remote_config.code == 200) {
                var group = remote_config.group_name;
                var template = remote_config.template;
                var player_url = config.host + '/' + template + '?group_name=' + group;
                request(player_url, function(error, response, html) {
                    if(!error) {
                        var $ = cheerio.load(html);
                        var tasks = [];
                        $('script').each(function() {
                            var script_url = $(this).attr('src');
                            var script_path = template + '/' + script_url.split(template + '/')[1];
                            tasks.push(async.apply(writeAsset, script_url, asset_dir + script_path));
                            $(this).attr('src', '/' + script_path);
                        });
                        $('link').each(function() {
                            var style_url = $(this).attr('href');
                            var style_path = template + '/' + style_url.split(template + '/')[1];
                            tasks.push(async.apply(writeAsset, style_url, asset_dir + style_path));
                            $(this).attr('href', '/' + style_path);
                        });
                        $('img').each(function() {
                            var img_url = $(this).attr('src');
                            var basename = getBasename(img_url);
                            var img_path = 'images/' + basename;
                            tasks.push(async.apply(writeAsset, img_url, asset_dir + img_path));
                            $(this).attr('src', '/' + img_path);
                        });
                        $('video').each(function() {
                            var video_url = $(this).attr('src');
                            var basename = getBasename(video_url);
                            var video_path = 'videos/' + basename;
                            tasks.push(async.apply(writeAsset, video_url, asset_dir + video_path));
                            $(this).attr('src', '/' + video_path);
                        });
                        async.parallel(tasks, function(err, results) {
                            if(!err) {
                                fs.writeFileSync(asset_dir + 'index.html', $.html());
                                console.log(getTimeString() + ' index.html written');
                                setTimeout(synchronize, config.sleep_length * 1000);
                            }
                        });
                    }
                    else {
                        console.log(getTimeString() + " couldn't load player template; trying again after sleep");
                        setTimeout(synchronize, config.sleep_length * 1000);
                    }
                });
            }
            else {
                console.log(getTimeString() + " player error code: " + remote_config.code + "; trying again after sleep");
                setTimeout(synchronize, config.sleep_length * 1000);
            }
        }
        else {
            console.log(getTimeString() + " couldn't load player configuration from server; trying again after sleep");
            setTimeout(synchronize, config.sleep_length * 1000);
        }
    });
};

app.listen('8080');

app.get('/', function(req, res) {
    if(fs.existsSync(asset_dir + 'index.html')) {
        res.send(fs.readFileSync(asset_dir + 'index.html', {encoding: 'utf8'}));
    }
    else {
        res.send("<!DOCTYPE html><html><head><meta http-equiv='refresh' content='5'></head><body>Syncronization underway, page will automatically refresh in 5 seconds.</body></html>");
    }
});


app.use(express.static(asset_dir));

synchronize();

exports = module.exports = app;

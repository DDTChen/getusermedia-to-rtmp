var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
//var ffmpeg = require('fluent-ffmpeg');
//var stream = require('stream');
var spawn = require('child_process').spawn;

//testing
spawn('ffmpeg',['-h']).on('error',function(m){
	console.error("FFMpeg not found in system cli; please install ffmpeg properly or make a softlink to ./!");
	process.exit(-1);
});

app.use(express.static('static'));

io.on('connection', function(socket){
	socket.emit('message','Hello from mediarecorder-to-rtmp server!');
	socket.emit('message','Please set rtmp destination before start streaming.');
	
	var ffmpeg_process, feedStream=false;
	socket.on('config_rtmpDestination',function(m){
		if(typeof m != 'string'){
			socket.emit('fatal','rtmp destination setup error.');
			return;
		}
		var regexValidator=/^rtmp:\/\/[^\s]*$/;//TODO: should read config
		if(!regexValidator.test(m)){
			socket.emit('fatal','rtmp address rejected.');
			return;
		}
		socket._rtmpDestination=m;
		socket.emit('message','rtmp destination set to:'+m);
	}); 
	socket._vcodec='libvpx';//from firefox default encoder
	socket.on('config_vcodec',function(m){
		if(typeof m != 'string'){
			socket.emit('fatal','input codec setup error.');
			return;
		}
		if(!/^[0-9a-z]{2,}$/.test(m)){
			socket.emit('fatal','input codec contains illegal character?.');
			return;
		}//for safety
		socket._vcodec=m;
	}); 	


	socket.on('start',function(m){
		if(ffmpeg_process || feedStream){
			socket.emit('fatal','stream already started.');
			return;
		}
		if(!socket._rtmpDestination){
			socket.emit('fatal','no destination given.');
			return;
		}
		var ops=[
			'-i', '-',
			'-c:v', 'libx264', '-preset', 'fast', //'-tune', 'zerolatency',
			// '-an', //TODO: give up audio for now...
			//'-async', '1', 
			//'-filter_complex', 'aresample=44100', //necessary for trunked streaming?
			'-c:a', 'aac', '-b:a', '128k',
			// '-bufsize', '6000',
			'-f', 'flv', socket._rtmpDestination
		];
// 14:43 不佳 視訊設定有誤
// 請將主影格頻率設為 4 秒或小於 4 秒。目前的主影格傳送頻率 (9.8 秒) 過低，因此可能造成緩衝處理的情況。請留意，如果發生內容擷取錯誤，可能會導致 GOP (影格組) 大小錯誤。
// 請檢查影片解析度。目前的解析度為 (640 X 480)，但這不是最佳解析度。
// 這個音訊串流的目前位元率 (71.00 Kbps) 低於建議值。請考慮將音訊串流的位元率改成 128 Kbps。
		ffmpeg_process=spawn('ffmpeg', ops);
		feedStream=function(data){
			ffmpeg_process.stdin.write(data);
			//write exception cannot be caught here.	
		}

		ffmpeg_process.stderr.on('data',function(d){
			socket.emit('ffmpeg_stderr',''+d);
		});
		ffmpeg_process.on('error',function(e){
			console.log('child process error'+e);
			socket.emit('fatal','ffmpeg error!'+e);
			feedStream=false;
			socket.disconnect();
		});
		ffmpeg_process.on('exit',function(e){
			console.log('child process exit'+e);
			socket.emit('fatal','ffmpeg exit!'+e);
			socket.disconnect();
		});
	});

	socket.on('binarystream',function(m){
		if(!feedStream){
			socket.emit('fatal','rtmp not set yet.');
			return;
		}
		feedStream(m);
	});
	socket.on('disconnect', function () {
		feedStream=false;
		if(ffmpeg_process)
		try{
			ffmpeg_process.stdin.end();
			ffmpeg_process.kill('SIGINT');
		}catch(e){console.warn('killing ffmoeg process attempt failed...');}
	});
	socket.on('error',function(e){
		console.log('socket.io error:'+e);
	});
});

io.on('error',function(e){
	console.log('socket.io error:'+e);
});

http.listen(8888, function(){
  console.log('http and websocket listening on *:8888');
});


process.on('uncaughtException', function(err) {
    // handle the error safely
    console.log(err)
    // Note: after client disconnect, the subprocess will cause an Error EPIPE, which can only be caught this way.
})
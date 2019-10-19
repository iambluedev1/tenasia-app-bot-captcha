const puppeteer = require('puppeteer-extra');

const RecaptchaPlugin = require('puppeteer-extra-plugin-recaptcha')
const recaptchaPlugin = RecaptchaPlugin({
  provider: { id: '2captcha', token: '7d3b51d092737961970cffaec16feb74' }
});
puppeteer.use(recaptchaPlugin);

const pluginStealth = require("puppeteer-extra-plugin-stealth");
puppeteer.use(pluginStealth());

var pp;
var retry = 0;
var email = "";
var password = "";
var country = "";

async function newEvaluate (page, fn, ...rawArgs) {
  const args = await Promise.all(rawArgs.map(arg => {
    return typeof arg === 'function'
      ? page.evaluateHandle(`(${arg.toString()})`)
      : arg;
  }));
  return page.evaluate(fn, ...args);
}

async function callAdsApi(page) {
	return await page.evaluate(async () => {
		let response = await fetch("https://tenasia.musicawards.co.kr/ad/watch", {
			"credentials": "include",
			"referrer": "https://tenasia.musicawards.co.kr/mypage-ticket",
			"body": "{}",
			"method": "POST",
			"mode": "cors"
		});
		let data = await response.json()
		//console.log(JSON.stringify(data));
		return data;
	});
}

async function callVoteApi(page, count, country) {
	return await page.evaluate(async (country, count) => {
		let response = await fetch("https://tenasia.musicawards.co.kr/vote", {
			"credentials": "include",
			"headers": {
				"Accept": "application/json, text/javascript, */*; q=0.01",
				"Accept-Language": "en-US,en;q=0.5",
				"Content-Type": "application/json",
				"X-Requested-With": "XMLHttpRequest",
				"Pragma": "no-cache",
				"Cache-Control": "no-cache"
			},
			"referrer": "https://tenasia.musicawards.co.kr/vote-prelims/" + country,
			"body": "{\"vote\":" + count + ",\"target\":\"BLACKPINK\",\"url\":\"https://tenasia.musicawards.co.kr/vote-prelims/" + country + "\"}",
			"method": "POST",
			"mode": "cors"
		});

		let data = await response.json()
		console.log(JSON.stringify(data));
		return data;
	}, country, count);
}

async function getFreeAds(page, cb){
	var datas = await callAdsApi(page);
	//console.log(datas);
	
	if(datas.result){
		console.log("getting free ads");
		await page.click("#btn-ad-action");
		try {
			await page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });
		}catch(e){}
		await getFreeAds(page, cb);
	}else{
		if(datas.time){
			console.log("waiting " + datas.time + " s");
			await page.waitFor(1000*(datas.time+2));
			console.log("refresh");
			await getFreeAds(page, cb);
		}else{
			console.log("no free ads left");
			cb();
		}
	}
}

async function vote(page, browser, country){
	await page.goto("https://tenasia.musicawards.co.kr/vote-prelims/" + country, {
		waitUntil: 'networkidle2'
	});
	/*await page.click(".vote[el-data-code='BLACKPINK']");
	await page.waitForSelector("#top-idol-code[el-data='BLACKPINK']");*/
	
	const vote = await page.evaluate(() => document.querySelector('.common-myTickets-body .content .title strong').innerText);
	console.log("Voting");
	console.log("Available votes : " + vote);

	if(vote == 0){
		console.error("already voted");
		setTimeout(() => {
			browser.close();
		}, 800)
		return;
	}else{
		var datas = await callVoteApi(page, vote, country);
		console.log(datas);
		if(datas.result){
			console.log("Successfully voted");
			browser.close();
		}else{
			if(datas.message == "투표할 수 있는 지역이 아닙니다."){
				console.error("An error ocurred, You are not in a voting area. Please try with a vpn or change your selected country.");
				browser.close();
				process.exit(1);	
			}else{
				console.error("An error ocurred, " + datas.message);
				browser.close();
				process.exit(1);	
			}
		}
	}
}

module.exports = () => {
	var args = process.argv.slice(2);

	if(args.length != 6){
		console.error("invalid args");
		process.exit(1);
	}else{
		
		email = args[1];
		password = args[3];
		country = args[5];

		(async () => {
			const buster = require('path').join(__dirname, 'extensions/buster');
			const clicker = require('path').join(__dirname, 'extensions/clicker');
		  
			const browser = await puppeteer.launch({
				headless: false,
				args: [
					'--no-sandbox', 
					'--start-maximized', 
					'--disable-setuid-sandbox', 
					'-disable-gpu', 
					'--no-first-run', 
					'--disable-notifications', 
				],
				defaultViewport: null
			});
		  
			const page = await browser.newPage();
			
			try {
				await page.goto('https://tenasia.musicawards.co.kr/oauth/kakao', {
					waitUntil: 'networkidle2'
				});
			}catch(e){
				console.error("Please verify your internet connection");
				browser.close();
				process.exit(1);
			}
			
			browser.on('targetchanged', async (t) => {
				var url = t.url();
				
				if(url == "https://tenasia.musicawards.co.kr/oauth/kakao/complete"){
					try {
						await page.waitForNavigation();
					}catch(e){}
					console.log("connected, redirecting");
					await page.goto("https://tenasia.musicawards.co.kr/mypage-ticket", {
						waitUntil: 'networkidle2'
					});
				}else if(url == "https://tenasia.musicawards.co.kr/mypage-ticket"){
					try {
						await page.waitForNavigation();
					}catch(e){}
					try {
						page.on('dialog', async dialog => {
							var msg = dialog.message();
							console.error("alert from website : " + msg);
							setTimeout(() => {
								browser.close();
								process.exit(1);
							}, 800)
						});
					} catch(e) {}
					console.log(url);
					await getFreeAds(page, async () => {
						console.log("voting for country : " + country);
						await vote(page, browser, country);
					});
				}
			})
		
			if(page.url().startsWith("https://accounts.kakao.com")){
				console.log("starting login process");
				await page.type("#id_email_2", email);
				await page.type("#id_password_3", password);
				await page.click(".submit");
						
				try {
					await page.waitForSelector("#login-form", { timeout: 5000, hidden: true });
				} catch (e) {
					const innerText = await page.evaluate(() => document.querySelector('#errorAlert > .desc_error').innerText);
					if(innerText == "▲ Click the checkbox."){
						console.log("captcha required");
						await page.click(".submit");
						await page.waitFor(1000);
						console.log("solving captcha");
						await page.solveRecaptchas();
						console.log("captcha solved");
						try {
							await Promise.all([
								page.waitForNavigation(),
								page.click(".submit"),
							])
						}catch(e){
							console.log("captcha solving failed, retry");
							await page.click(".submit");
							await page.waitFor(1000);
							console.log("solving captcha");
							await page.solveRecaptchas();
							console.log("captcha solved");
							try {
								await Promise.all([
									page.waitForNavigation(),
									page.click(".submit"),
								])
							}catch(e){
								const innerText = await page.evaluate(() => document.querySelector('#errorAlert > .desc_error').innerText);
								console.error("login failed:" + innerText);
								setTimeout(() => {
									browser.close();
									process.exit(1);
								}, 800)
								return;
							}
						}
					}else{
						console.error("login failed : " + innerText);
						setTimeout(() => {
							browser.close();
							process.exit(1);
						}, 800)
						return;
					}
				}
			}
			
		})();
	}
}
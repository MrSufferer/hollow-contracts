const hre = require("hardhat");
var frontendUtil = require('@arcologynetwork/frontend-util/utils/util')
const nets = require('../../network.json');

async function main() {  
  accounts = await ethers.getSigners(); 
  const provider = new ethers.providers.JsonRpcProvider(nets[hre.network.name].url);
  const pkCreator=nets[hre.network.name].accounts[0]
  const signerCreator = new ethers.Wallet(pkCreator, provider);
  const txbase = 'benchmark/uniswap/txs';
  frontendUtil.ensurePath(txbase);
  


  const tokenCount=10;  //Token number
  const poolStyle=2;    //Liquidity Pool Organization
                        // 2 - (tokenA tokenB)  (tokenC tokenD)   
                        // 1 - (tokenA tokenB)  (tokenB tokenC)  (tokenC tokenD)

  const flag0_poolInit=true;
  const flag1_liquidity_mint=true;
  const flag2_swap=false;

  const [swapfactory,nonfungiblePositionManager,router,nettingEngine] = await deployBaseContract();

  
  let i,tx;

  console.log('===========start create Token=====================')
  const tokenFactory = await ethers.getContractFactory("Token");
  var tokenInsArray=new Array();
  for(i=0;i<tokenCount;i++){
    const tokenIns = await tokenFactory.deploy("token"+i, "TKN"+i);
    await tokenIns.deployed();
    tokenInsArray.push(tokenIns);
    console.log(`Deployed token${i} at ${tokenIns.address}`);
  }
  
  console.log('===========start create UniswapV3Pool=====================')
  const fee=3000;  
  var poolAdrArray=new Array();
  let PoolCreatedDate,strlen,poolAddress;
  for (i=0;i+1<tokenCount;i=i+poolStyle) {
      tx = await swapfactory.createPool(tokenInsArray[i].address, tokenInsArray[i+1].address, fee);
      receipt = await tx.wait();
      // console.log(receipt);
      frontendUtil.showResult(frontendUtil.parseReceipt(receipt));
      poolAddress=parseEvent(receipt,swapfactory,"PoolCreated");
      console.log(`UniswapV3Pool created at ${poolAddress}, token${i}<--->>token${i+1} fee:${fee}`);
      poolAdrArray.push(poolAddress); 
  }

  console.log('===========start init UniswapV3Pool in nettingEngine=====================')
  for (i=0;i<poolAdrArray.length;i++)  {
      tx = await nettingEngine.initPool(poolAdrArray[i],tokenInsArray[i*2].address, tokenInsArray[i*2+1].address);
      receipt = await tx.wait();
      frontendUtil.showResult(frontendUtil.parseReceipt(receipt));
      console.log(`Init UniswapV3Pool at ${poolAdrArray[i]} in nettingEngine`);
  }

  console.log('===========start initialize UniswapV3Pool=====================')
  let sqrtPriceX96 = ethers.BigNumber.from("79228162514264337593543950336");     //  2^96  1:1
  // const sqrtPriceX96 = ethers.BigNumber.from("158456325028528675187087900672");     // 2^97  4:1
  const sqrtPriceRate=2;
  sqrtPriceX96=sqrtPriceX96.mul(sqrtPriceRate);
  let price=sqrtPriceRate*sqrtPriceRate;

  var poolArray=new Array();
  for (i=0;i<poolAdrArray.length;i++) {
    const pool = await ethers.getContractAt("UniswapV3Pool", poolAdrArray[i]);
    poolArray.push(pool);
  }
  
  if(flag0_poolInit){
    var txs=new Array();
    for (i=0;i<poolArray.length;i++) {
      txs.push(frontendUtil.generateTx(function([pool,sqrtPriceX96]){
        return pool.initialize(sqrtPriceX96);
      },poolArray[i],sqrtPriceX96));
    }
    await frontendUtil.waitingTxs(txs);
  }
  
  // console.log('===========start mint token for addLiquidity=====================')
  
  let mintAmount=ethers.utils.parseUnits("80000000", 18)
  // let mintAmount=ethers.utils.parseUnits("8000", 18)
  let amountA ,amountB
  if(flag1_liquidity_mint){
    console.log('===========start mint token=====================')
    var txs=new Array();
    for (i=0;i+1<tokenCount;i=i+poolStyle) {
      [amountA ,amountB]=computeMintAmount(tokenInsArray[i].address,tokenInsArray[i+1].address,mintAmount,price);

      txs.push(frontendUtil.generateTx(function([token,receipt,amount]){
        return token.mint(receipt,amount);
      },tokenInsArray[i],accounts[i].address,amountA));

      txs.push(frontendUtil.generateTx(function([token,receipt,amount]){
        return token.mint(receipt,amount);
      },tokenInsArray[i+1],accounts[i].address,amountB));
    }
    await frontendUtil.waitingTxs(txs);

    console.log('===========start approve token=====================')
    txs=new Array();
    for (i=0;i+1<tokenCount;i=i+poolStyle) {
      [amountA ,amountB]=computeMintAmount(tokenInsArray[i].address,tokenInsArray[i+1].address,mintAmount,price);

      txs.push(frontendUtil.generateTx(function([token,from,nonfungiblePositionManagerAdr,amount]){
        return token.connect(from).approve(nonfungiblePositionManagerAdr,amount);
      },tokenInsArray[i],accounts[i],nonfungiblePositionManager.address,amountA));

      txs.push(frontendUtil.generateTx(function([token,from,nonfungiblePositionManagerAdr,amount]){
        return token.connect(from).approve(nonfungiblePositionManagerAdr,amount);
      },tokenInsArray[i+1],accounts[i],nonfungiblePositionManager.address,amountB));
    }
    await frontendUtil.waitingTxs(txs);

  }
  

  console.log('===========before addLiquidity=====================')
  for (i=0;i+1<tokenCount;i=i+poolStyle) {
    await getBalance(tokenInsArray[i],accounts[i],i);
    await getBalance(tokenInsArray[i+1],accounts[i],i+1);
  }

  console.log('===========addLiquidity=====================')
  
  var txs=new Array();
  let token0,token1,amount0Desired,amount1Desired;
  for (i=0;i+1<tokenCount;i=i+poolStyle) {
    [amountA ,amountB]=computeMintAmount(tokenInsArray[i].address,tokenInsArray[i+1].address,mintAmount,price);
    [token0,token1,amount0Desired,amount1Desired]=getLiquidityParams(tokenInsArray[i],tokenInsArray[i+1],amountA,amountB);

    from=accounts[i]

    const params = {
      token0: token0,
      token1: token1,
      fee: fee, 
      tickLower: -887220,
      tickUpper: 887220,
      amount0Desired: amount0Desired, 
      amount1Desired: amount1Desired,
      amount0Min: 0,
      amount1Min: 0,
      recipient: from.address, 
      deadline: Math.floor(Date.now() / 1000) + 60 * 20,
    };
    tx = await nonfungiblePositionManager.connect(from).mint(params, {
      gasLimit: 500000000,
    });
    receipt=await tx.wait();
    frontendUtil.showResult(frontendUtil.parseReceipt(receipt));
  }
  
  console.log('===========after addLiquidity=====================')
  for (i=0;i+1<tokenCount;i=i+poolStyle) {
    await getBalance(tokenInsArray[i],accounts[i],i);
    await getBalance(tokenInsArray[i+1],accounts[i],i+1);
  }
  
  //-------------------------------for swap----------------------------------
  let accountsLength=accounts.length
  if(flag2_swap){
    console.log('===========start mint token=====================')
    let j;
    for (i=0;i+1<tokenCount;i=i+poolStyle) {
      var txs=new Array();
      for(j=0;j+1<accountsLength;j=j+2){
        mintAmount=ethers.utils.parseUnits("1", 18).mul(j+1);
        // console.log(`mint token for swap: ${mintAmount} at i:${i} j:${j}`);
        [amountA ,amountB]=computeMintAmount(tokenInsArray[i].address,tokenInsArray[i+1].address,mintAmount,price);

        txs.push(frontendUtil.generateTx(function([token,receipt,amount]){
          return token.mint(receipt,amount);
        },tokenInsArray[i],accounts[j].address,amountA));

        txs.push(frontendUtil.generateTx(function([token,receipt,amount]){
          return token.mint(receipt,amount);
        },tokenInsArray[i+1],accounts[j+1].address,amountB));
      }
      await frontendUtil.waitingTxs(txs);
    }


    console.log('===========start approve token=====================')
    
    for (i=0;i+1<tokenCount;i=i+poolStyle) {
      var txs=new Array();
      for(j=0;j+1<accountsLength;j=j+2){
        mintAmount=ethers.utils.parseUnits("1", 18).mul(j+1);
        //console.log(`approve token for swap: ${mintAmount} at i:${i} j:${j}`);
        [amountA ,amountB]=computeMintAmount(tokenInsArray[i].address,tokenInsArray[i+1].address,mintAmount,price);

        txs.push(frontendUtil.generateTx(function([token,from,routerAdr,amount]){
          return token.connect(from).approve(routerAdr,amount);
        },tokenInsArray[i],accounts[j],router.address,amountA.mul(2)));

        txs.push(frontendUtil.generateTx(function([token,from,routerAdr,amount]){
          return token.connect(from).approve(routerAdr,amount);
        },tokenInsArray[i+1],accounts[j+1],router.address,amountB.mul(2)));
      }
      await frontendUtil.waitingTxs(txs);
    }
    
    console.log('===========before swap=====================')
    for (i=0;i+1<tokenCount;i=i+poolStyle) {
      await getBalance(tokenInsArray[i],accounts[i],i);
      await getBalance(tokenInsArray[i+1],accounts[i],i+1);

      await getBalance(tokenInsArray[i],accounts[i+1],i);
      await getBalance(tokenInsArray[i+1],accounts[i+1],i+1);
    }

    console.log('===========start swap=====================')
    
    for (i=0;i+1<tokenCount;i=i+poolStyle) {
      var txs=new Array();
      for(j=0;j+1<accountsLength;j=j+2){
      // for(j=0;j+1<4;j=j+2){
        mintAmount=ethers.utils.parseUnits("1", 18).mul(j+1);
        // console.log(`swap: ${mintAmount} at i:${i} j:${j}`);
        [amountA ,amountB]=computeMintAmount(tokenInsArray[i].address,tokenInsArray[i+1].address,mintAmount,price);

        txs.push(frontendUtil.generateTx(function([nettingEngine,from,tokenA,tokenB,fee,amountIn]){
          return swap(tokenA,tokenB,fee,from,amountIn,nettingEngine,true);
        },nettingEngine,accounts[j],tokenInsArray[i].address,tokenInsArray[i+1].address,fee,amountA));

        txs.push(frontendUtil.generateTx(function([nettingEngine,from,tokenA,tokenB,fee,amountIn]){
          return swap(tokenA,tokenB,fee,from,amountIn,nettingEngine,true);
        },nettingEngine,accounts[j+1],tokenInsArray[i+1].address,tokenInsArray[i].address,fee,amountB));

      }
      await frontendUtil.waitingTxs(txs);
    }

    console.log('===========after swap=====================')
    for (i=0;i+1<tokenCount;i=i+poolStyle) {
      await getBalance(tokenInsArray[i],accounts[i],i);
      await getBalance(tokenInsArray[i+1],accounts[i],i+1);

      await getBalance(tokenInsArray[i],accounts[i+1],i);
      await getBalance(tokenInsArray[i+1],accounts[i+1],i+1);
    }

  }else{
    frontendUtil.ensurePath(txbase + '/mint');
    const handle_swap_token_mint = frontendUtil.newFile(txbase + '/mint/mint.out');
    frontendUtil.ensurePath(txbase + '/approve');
    const handle_swap_token_approve=frontendUtil.newFile(txbase + '/approve/approve.out')
    frontendUtil.ensurePath(txbase + '/swap');
    const handle_swap=frontendUtil.newFile(txbase + '/swap/swap.out')

    let pk,signer,pk1,signer1,params

    for (i=0;i+1<tokenCount;i=i+poolStyle) {
      for(j=0;j+1<accounts.length;j=j+2){
        
        mintAmount=ethers.utils.parseUnits("1", 18).mul(getRandom(4));
        [amountA ,amountB]=computeMintAmount(tokenInsArray[i].address,tokenInsArray[i+1].address,mintAmount,price);
        console.log(`swap: ${mintAmount} at i:${i} j:${j} amountA: ${amountA}  amountB:${amountB} `);
        //mint
        tx = await tokenInsArray[i].populateTransaction.mint(accounts[j].address,amountA,{gasPrice:255,});
        await writePreSignedTxFile(handle_swap_token_mint,signerCreator,tx);

        tx = await tokenInsArray[i+1].populateTransaction.mint(accounts[j+1].address,amountB,{gasPrice:255,});
        await writePreSignedTxFile(handle_swap_token_mint,signerCreator,tx);

        //approve
        pk=nets[hre.network.name].accounts[j];
        signer = new ethers.Wallet(pk, provider);

        tx = await tokenInsArray[i].connect(accounts[j]).populateTransaction.approve(router.address,amountA,{gasPrice:255,});
        await writePreSignedTxFile(handle_swap_token_approve,signer,tx);


        pk1=nets[hre.network.name].accounts[j+1];
        signer1 = new ethers.Wallet(pk1, provider);

        tx = await tokenInsArray[i+1].connect(accounts[j+1]).populateTransaction.approve(router.address,amountB,{gasPrice:255,});
        await writePreSignedTxFile(handle_swap_token_approve,signer1,tx);

        
        tx = await swap(tokenInsArray[i].address,tokenInsArray[i+1].address,fee,accounts[j],amountA,nettingEngine,false);
        await writePreSignedTxFile(handle_swap,signer,tx);

        tx = await swap(tokenInsArray[i+1].address,tokenInsArray[i].address,fee,accounts[j+1],amountB,nettingEngine,false);
        await writePreSignedTxFile(handle_swap,signer1,tx);
      }
      console.log(`create swap txs : ${(i+1)*accounts.length} `);
    }
  }
}

function parseEvent(receipt,contract,eventName){
  if(receipt.hasOwnProperty("status")&&receipt.status==1){
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if(eventName===parsed.name){
          idx=0;
          for(const arg of parsed.args){
              if(idx===4){
                return arg;
              }
              idx=idx+1;
          }
        }
      } catch (e) {
        console.log(e);
      }
    }
  }
  return "";
}

async function swap(tokenA,tokenB,fee,from,amountIn,nettingEngine,isExecute){
  const params = {
      tokenIn: tokenA,                
      tokenOut: tokenB,               
      fee: fee,                            
      recipient: from.address,                    
      deadline: Math.floor(Date.now() / 1000) + 60 * 10, 
      amountIn: amountIn, 
      amountOutMinimum: 0,                     
      sqrtPriceLimitX96: 0                     
  };
  if(isExecute){
    return nettingEngine.connect(from).queueSwapRequest(params, {
      // gasLimit: 50000000000 ,
      gasPrice:255,
    });
  }else{
    return nettingEngine.connect(from).populateTransaction.queueSwapRequest(params, {
      // gasLimit: 50000000000 ,
      gasPrice:255,
    });
  }
  

}

function getRandom(seed){
  return Math.floor(Math.random() * seed) + 1;
}
function getLiquidityParams(tokenInsA,tokenInsB,amountA,amountB){
  const tokenA=tokenInsA.address.toLowerCase();
  const tokenB=tokenInsB.address.toLowerCase();


  let amount0Desired=amountA;
  let amount1Desired=amountB;
  let token0,token1;

  if(tokenA < tokenB){
    token0=tokenA;
    token1=tokenB;
  }else{
    token0=tokenB;
    token1=tokenA;

    amount0Desired=amountB;
    amount1Desired=amountA;

  }

  return [token0,token1,amount0Desired,amount1Desired]
}


async function getBalance(token,account,tokenIdx){
  const decimals=18;
  let tx = await token.balanceOf(account.address);
  let receipt=await tx.wait();
  let balance=BigInt(frontendUtil.parseEvent(receipt,token,"BalanceQuery"));
  formattedBalance = ethers.utils.formatUnits(balance, decimals);
  console.log(`Balance of account ${account.address}: ${formattedBalance} token${tokenIdx}`);
}

async function deployBaseContract(){
  console.log('===========start UniswapV3Factory=====================')
  const UniswapV3Factory = await hre.ethers.getContractFactory("UniswapV3Factory");
  const swapfactory = await UniswapV3Factory.deploy();
  await swapfactory.deployed();
  console.log("UniswapV3Factory deployed to:", swapfactory.address);


  console.log('===========start deploy WETH9=====================');
  const weth9_factory = await ethers.getContractFactory("WETH9");
  const weth9 = await weth9_factory.deploy();
  await weth9.deployed();
  console.log(`Deployed WETH9 at ${weth9.address}`);
  const weth9addr=weth9.address

  console.log('===========start deploy NFTDescriptor=====================');
  const Lib = await ethers.getContractFactory("NFTDescriptor");
  const lib = await Lib.deploy();
  await lib.deployed();
  console.log(`Deployed NFTDescriptor at ${lib.address}`);
  
  console.log('===========start deploy NonfungibleTokenPositionDescriptor=====================');
  const nativeCurrencyLabelBytes = ethers.utils.formatBytes32String("ACL");
  const NonfungibleTokenPositionDescriptor_factory = await hre.ethers.getContractFactory("NonfungibleTokenPositionDescriptor", {
    signer: accounts[0],
    libraries: {
      NFTDescriptor: lib.address,
    },
  });
  const nonfungibleTokenPositionDescriptor = await NonfungibleTokenPositionDescriptor_factory.deploy(
    weth9.address,
    nativeCurrencyLabelBytes
  );
  await nonfungibleTokenPositionDescriptor.deployed();
  console.log("nonfungibleTokenPositionDescriptor deployed to:", nonfungibleTokenPositionDescriptor.address);
  
  console.log('===========start deploy NonfungiblePositionManager=====================');
  const NonfungiblePositionManager_factory = await hre.ethers.getContractFactory("NonfungiblePositionManager");
  const nonfungiblePositionManager = await NonfungiblePositionManager_factory.deploy(
    swapfactory.address,   
    weth9.address,
    nonfungibleTokenPositionDescriptor.address               
  );
  await nonfungiblePositionManager.deployed();
  console.log("NonfungiblePositionManager deployed to:", nonfungiblePositionManager.address);

  console.log('===========start deploy SwapRouter=====================');
  const router_factory = await hre.ethers.getContractFactory("SwapRouter");
  const router = await router_factory.deploy(
    swapfactory.address,   
    weth9.address            
  );
  await router.deployed();
  console.log("SwapRouter deployed to:", router.address);

  // console.log('===========start deploy PoolLibary=====================');
  // const pool_Libary = await hre.ethers.getContractFactory("PoolLibary");
  // const poolLibary = await pool_Libary.deploy();
  // await poolLibary.deployed();
  // console.log("poolLibary deployed to:", poolLibary.address);
  
  console.log('===========start deploy Netting=====================');
  const netting_factory = await hre.ethers.getContractFactory("Netting");
  const netting = await netting_factory.deploy(router.address);
  await netting.deployed();
  console.log("SwapCore deployed to:", netting.address);
  
  console.log('===========start deploy NettingEngine=====================');
  const nettingEngine_factory = await hre.ethers.getContractFactory("NettingEngine");
  const nettingEngine = await nettingEngine_factory.deploy();
  console.log("NettingEngine deployed to:", nettingEngine.address);

  console.log('===========initialization for NettingEngine=====================');
  tx = await nettingEngine.init(swapfactory.address,netting.address);
  receipt = await tx.wait();
  // console.log(receipt);
  frontendUtil.showResult(frontendUtil.parseReceipt(receipt));
  
  return [swapfactory,nonfungiblePositionManager,router,nettingEngine]
}

async function writePreSignedTxFile(txfile,signer,tx){
  const fulltx=await signer.populateTransaction(tx)
  const rawtx=await signer.signTransaction(fulltx)
  frontendUtil.appendTo(txfile,rawtx+',\n')
}

function computeMintAmount(token0,token1,amount1,price){
  let amountA,amountB;
  if(token0 < token1){
    amountA=amount1.div(price);
    amountB=amount1;
  }else{
    amountA=amount1;
    amountB=amount1.div(price);
  }
  return [amountA,amountB]
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

declare var global: any;
import fs from 'fs';
import Web3 from 'web3';
import crypto from 'crypto';
import { EthereumProvider, Artifacts, HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction, Address, Deployment, DeploymentsExtension } from 'hardhat-deploy-holographed/types';
import { BigNumberish, BytesLike, ContractFactory, Contract, BigNumber } from 'ethers';
import type { ethers } from 'ethers';
import type EthersT from 'ethers';
import { HardhatEthersHelpers } from '@nomiclabs/hardhat-ethers/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { lazyObject } from 'hardhat/plugins';
import {
  getContractAt,
  getContractFactory,
  getSigners,
  getSigner,
  getContract,
  getContractOrNull,
  getNamedSigners,
  getNamedSigner,
  getSignerOrNull,
  getNamedSignerOrNull,
  getUnnamedSigners,
} from '@nomiclabs/hardhat-ethers/internal/helpers';
import type * as ProviderProxyT from '@nomiclabs/hardhat-ethers/internal/provider-proxy';
import { DeploymentConfigStruct } from '../../typechain-types/HolographFactory';
import networks from '../../config/networks';

export interface LeanHardhatRuntimeEnvironment {
  networkName: string;
  deployments: DeploymentsExtension;
  getNamedAccounts: () => Promise<{
    [name: string]: Address;
  }>;
  getUnnamedAccounts: () => Promise<string[]>;
  getChainId(): Promise<string>;
  provider: EthereumProvider;
  ethers: typeof ethers & HardhatEthersHelpers;
  artifacts: Artifacts;
  deploymentSalt: string;
}

export interface Network {
  chain: number;
  rpc: string;
  holographId: number;
  tokenName: string;
  tokenSymbol: string;
  lzEndpoint?: string;
  webSocket?: string;
}

export interface Networks {
  [key: string]: Network;
}

export interface Signature {
  r: string;
  s: string;
  v: string;
}

const web3 = new Web3();

const isDefined = function (obj: any): boolean {
  return typeof obj !== 'undefined';
};

const bytesToHex = function (bytes: number[]): string {
  return web3.utils.bytesToHex(bytes);
};

const hexToBytes = function (hex: string): number[] {
  return web3.utils.hexToBytes(hex);
};

const stringToHex = function (str: string): string {
  return web3.utils.utf8ToHex(str) as string;
};

const randomHex = function (bytes: number, prepend: boolean = true): string {
  let text: string = '';
  for (let i: number = 0; i < bytes; i++) {
    text += Math.floor(Math.random() * 255)
      .toString(16)
      .padStart(2, '0');
  }
  return (prepend ? '0x' : '') + text;
};

const StrictECDSA = function (signature: Signature): Signature {
  const validator: BigNumber = BigNumber.from('0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0');
  if (parseInt(signature.v) < 27) {
    signature.v = '0x' + (27).toString(16).padStart(2, '0');
  }
  if (BigNumber.from(signature.s).gt(validator)) {
    // we have an issue
    signature.s = BigNumber.from('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141')
      .sub(BigNumber.from(signature.s))
      .toHexString();
    let v = parseInt(signature.v);
    if (v == 27) {
      v = 28;
    } else {
      v = 27;
    }
    signature.v = '0x' + v.toString(16).padStart(2, '0');
  }
  return signature;
};

const l2Ethers = function (hre1: HardhatRuntimeEnvironment) {
  let hre = { ...hre1 };
  hre.deployments = hre1.companionNetworks['l2'].deployments;
  hre.getNamedAccounts = hre1.companionNetworks['l2'].getNamedAccounts;
  hre.getUnnamedAccounts = hre1.companionNetworks['l2'].getUnnamedAccounts;
  hre.getChainId = hre1.companionNetworks['l2'].getChainId;
  hre.ethers = lazyObject(() => {
    const { createProviderProxy } =
      require('@nomiclabs/hardhat-ethers/internal/provider-proxy') as typeof ProviderProxyT;

    const { ethers } = require('ethers') as typeof EthersT;

    const providerProxy = createProviderProxy(hre1.companionNetworks['l2'].provider);
    //hre1.companionNetworks['l2'].provider.setMaxListeners(100);

    return {
      ...ethers,

      // The provider wrapper should be removed once this is released
      // https://github.com/nomiclabs/hardhat/pull/608
      provider: providerProxy,

      // We cast to any here as we hit a limitation of Function#bind and
      // overloads. See: https://github.com/microsoft/TypeScript/issues/28582
      getContractFactory: getContractFactory.bind(null, hre) as any,
      getContractAt: async <T extends EthersT.Contract>(
        nameOrAbi: string | any[],
        address: string,
        signer?: EthersT.Signer | string
      ) => getContractAt<T>(hre, nameOrAbi, address, signer),

      getSigners: async () => getSigners(hre),
      getSigner: async (address) => getSigner(hre, address),
      getSignerOrNull: async (address) => getSignerOrNull(hre, address),

      getNamedSigners: async () => getNamedSigners(hre),
      getNamedSigner: async (name) => getNamedSigner(hre, name),
      getNamedSignerOrNull: async (name) => getNamedSignerOrNull(hre, name),
      getUnnamedSigners: async () => getUnnamedSigners(hre),

      getContract: async <T extends EthersT.Contract>(name: string, signer?: EthersT.Signer | string) =>
        getContract<T>(hre, name, signer),
      getContractOrNull: async <T extends EthersT.Contract>(name: string, signer?: EthersT.Signer | string) =>
        getContractOrNull<T>(hre, name, signer),
    };
  });
  return hre.ethers;
};

const hreSplit = async function (
  hre1: HardhatRuntimeEnvironment,
  flip?: boolean
): Promise<{ hre: LeanHardhatRuntimeEnvironment; hre2: LeanHardhatRuntimeEnvironment }> {
  let localnet: boolean = hre1.network.name == 'localhost' || hre1.network.name == 'localhost2';
  if (localnet && !isDefined(hre1.network.companionNetworks['l2'])) {
    throw new Error(
      'A companion network is required for multi-chain testing. Use "companionNetworks" inside of Hardhat networks config file.'
    );
  }
  let hre: LeanHardhatRuntimeEnvironment;
  let hre2: LeanHardhatRuntimeEnvironment;
  let hre3: LeanHardhatRuntimeEnvironment;
  let salt: string = global.__DEPLOYMENT_SALT || '0x' + '00'.repeat(32);
  if (typeof global.__hreL1 === 'undefined') {
    hre = {
      networkName: hre1.network.name,
      deployments: hre1.deployments,
      getNamedAccounts: hre1.getNamedAccounts,
      getUnnamedAccounts: hre1.getUnnamedAccounts,
      getChainId: hre1.getChainId,
      provider: hre1.network.provider,
      ethers: hre1.ethers,
      artifacts: hre1.artifacts,
      deploymentSalt: salt,
    };
    global.__hreL1 = hre;
  } else {
    hre = global.__hreL1 as LeanHardhatRuntimeEnvironment;
  }
  if (typeof global.__hreL2 === 'undefined') {
    if (localnet) {
      hre2 = {
        networkName: hre1.network.companionNetworks['l2'],
        deployments: hre1.companionNetworks['l2'].deployments,
        getNamedAccounts: hre1.companionNetworks['l2'].getNamedAccounts,
        getUnnamedAccounts: hre1.companionNetworks['l2'].getUnnamedAccounts,
        getChainId: hre1.companionNetworks['l2'].getChainId,
        provider: hre1.companionNetworks['l2'].provider,
        ethers: l2Ethers(hre1),
        artifacts: hre1.artifacts,
        deploymentSalt: salt,
      };
    } else {
      hre2 = hre;
    }
    global.__hreL2 = hre2;
  } else {
    hre2 = global.__hreL2 as LeanHardhatRuntimeEnvironment;
  }
  if (flip) {
    hre3 = hre;
    hre = hre2;
    hre2 = hre3;
  }
  return {
    hre,
    hre2,
  };
};

const functionHash = function (func: string): string {
  return web3.eth.abi.encodeFunctionSignature(func);
};

const bitwiseXorHexString = function (pinBlock1: string, pinBlock2: string): string {
  pinBlock1 = pinBlock1.substring(2);
  pinBlock2 = pinBlock2.substring(2);
  let result: string = '';
  for (let index: number = 0; index < 8; index++) {
    let temp: string = (parseInt(pinBlock1.charAt(index), 16) ^ parseInt(pinBlock2.charAt(index), 16))
      .toString(16)
      .toLowerCase();
    result += temp;
  }
  return '0x' + result;
};

const XOR = function (hashes: string[]): string {
  let output: string = '0x00000000';
  for (let i: number = 0, l: number = hashes.length; i < l; i++) {
    output = bitwiseXorHexString(output, hashes[i]);
  }
  return output;
};

const buildDomainSeperator = function (chainId: number, name: string, version: string, address: string): string {
  let nameHash: string = web3.utils.keccak256(web3.utils.utf8ToHex(name));
  let versionHash: string = web3.utils.keccak256(web3.utils.utf8ToHex(version));
  let typeHash: string = web3.utils.keccak256(
    web3.utils.utf8ToHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
  );
  return web3.utils.keccak256(
    web3.eth.abi.encodeParameters(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [typeHash, nameHash, versionHash, chainId, address]
    )
  );
};

const generateInitCode = function (vars: string[], vals: any[]): string {
  return web3.eth.abi.encodeParameters(vars, vals);
};

const generateDeployCode = function (chainId: string, salt: string, byteCode: string, initCode: string): string {
  return web3.eth.abi.encodeFunctionCall(
    {
      name: 'deploy',
      type: 'function',
      inputs: [
        {
          type: 'uint256',
          name: 'chainId',
        },
        {
          type: 'bytes12',
          name: 'saltHash',
        },
        {
          type: 'bytes',
          name: 'sourceCode',
        },
        {
          type: 'bytes',
          name: 'initCode',
        },
      ],
    },
    [
      chainId, // uint256 chainId
      '0x' + salt.substring(salt.length - 24), // bytes12 sourceCode
      byteCode, // bytes memory sourceCode
      initCode, // bytes memory initCode
    ]
  );
};

const zeroAddress = function (): string {
  return '0x' + '00'.repeat(20);
};

const isContractDeployed = function (contract: Contract | null): boolean {
  return !(
    contract == null ||
    !contract?.address ||
    contract?.address == null ||
    contract?.address == '' ||
    contract?.address == zeroAddress()
  );
};

const genesisDeriveFutureAddress = async function (
  hre: LeanHardhatRuntimeEnvironment,
  salt: string,
  name: string,
  initCode: string
): Promise<string> {
  const chainId: string = BigNumber.from(networks[hre.networkName].chain).toHexString();
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy, deterministicCustom } = deployments;
  const { deployer } = await getNamedAccounts();
  let holographGenesis: any = await ethers.getContractOrNull('HolographGenesis');
  if (holographGenesis == null) {
    try {
      holographGenesis = await deployments.get('HolographGenesis');
    } catch (ex: any) {
      throw new Error('We need to have HolographGenesis deployed.');
    }
  }
  const contractBytecode: BytesLike = ((await ethers.getContractFactory(name)) as ContractFactory).bytecode;
  const contractDeterministic = await deterministicCustom(name, {
    from: deployer,
    args: [],
    log: true,
    deployerAddress: holographGenesis?.address,
    saltHash: deployer + salt.substring(salt.length - 24),
    deployCode: generateDeployCode(chainId, salt, contractBytecode, initCode),
  });
  return contractDeterministic.address;
};

const genesisDeployHelper = async function (
  hre: LeanHardhatRuntimeEnvironment,
  salt: string,
  name: string,
  initCode: string,
  contractAddress: string = zeroAddress()
): Promise<Contract> {
  const chainId: string = BigNumber.from(networks[hre.networkName].chain).toHexString();
  const { deployments, getNamedAccounts, ethers } = hre;
  const { deploy, deterministicCustom } = deployments;
  const { deployer } = await getNamedAccounts();
  let holographGenesis: any = await ethers.getContractOrNull('HolographGenesis');
  if (holographGenesis == null) {
    try {
      holographGenesis = await deployments.get('HolographGenesis');
    } catch (ex: any) {
      // we do nothing
    }
  }
  let contract: any = await ethers.getContractOrNull(name);
  if (contract == null) {
    try {
      contract = await deployments.get(name);
    } catch (ex: any) {
      // we do nothing
    }
  }
  if (
    !isContractDeployed(contract) ||
    (contract != null && (contract.address as string).toLowerCase() != contractAddress.toLowerCase())
  ) {
    const contractBytecode: BytesLike = ((await ethers.getContractFactory(name)) as ContractFactory).bytecode;
    const contractDeterministic = await deterministicCustom(name, {
      from: deployer,
      args: [],
      log: true,
      deployerAddress: holographGenesis?.address,
      saltHash: deployer + salt.substring(salt.length - 24),
      deployCode: generateDeployCode(chainId, salt, contractBytecode, initCode),
      waitConfirmations: 1,
      nonce: await ethers.provider.getTransactionCount(deployer),
    });
    deployments.log('future "' + name + '" address is', contractDeterministic.address);
    await contractDeterministic.deploy();
    contract = await ethers.getContract(name);
  } else {
    deployments.log('reusing "' + name + '" at', contract?.address);
  }
  if (contract == null) {
    return {} as Contract;
  } else {
    return contract as Contract;
  }
};

const utf8ToBytes32 = function (str: string): string {
  return (
    '0x' +
    Array.from(str)
      .map((c) =>
        c.charCodeAt(0) < 128 ? c.charCodeAt(0).toString(16) : encodeURIComponent(c).replace(/\%/g, '').toLowerCase()
      )
      .join('')
      .padStart(64, '0')
  );
};

const ZERO_ADDRESS: string = '0x0000000000000000000000000000000000000000';

const remove0x = function (input: string): string {
  if (input.startsWith('0x')) {
    return input.substring(2);
  } else {
    return input;
  }
};

const sha256 = function (x: string): string {
  return '0x' + crypto.createHash('sha256').update(x, 'utf8').digest('hex');
};

export interface Erc721Config {
  erc721Config: DeploymentConfigStruct;
  erc721ConfigHash: BytesLike;
  erc721ConfigHashBytes: number[];
}
const generateErc721Config = async function (
  network: Network,
  deployer: BytesLike,
  contractName: string,
  collectionName: string,
  collectionSymbol: string,
  royaltyBps: BigNumberish,
  eventConfig: BytesLike,
  initCode: BytesLike,
  salt: BytesLike
): Promise<Erc721Config> {
  let hre: LeanHardhatRuntimeEnvironment;
  if (typeof global.__hreL1 === 'undefined') {
    throw new Error('LeanHardhatRuntimeEnvironment has not been cached yet.');
  } else {
    hre = global.__hreL1 as LeanHardhatRuntimeEnvironment;
  }
  let chainId: string = '0x' + network.holographId.toString(16).padStart(8, '0');
  let erc721Hash: string = '0x' + web3.utils.asciiToHex('HolographERC721').substring(2).padStart(64, '0');
  let artifact: ContractFactory = await hre.ethers.getContractFactory(contractName);
  let erc721Config: DeploymentConfigStruct = {
    contractType: erc721Hash,
    chainType: chainId,
    salt: salt,
    byteCode: artifact.bytecode,
    initCode: generateInitCode(
      ['string', 'string', 'uint16', 'uint256', 'bool', 'bytes'],
      [
        collectionName, // string memory contractName
        collectionSymbol, // string memory contractSymbol
        royaltyBps, // uint16 contractBps
        eventConfig, // uint256 eventConfig
        false, // bool skipInit
        initCode,
      ]
    ),
  };
  let erc721ConfigHash: BytesLike = web3.utils.keccak256(
    '0x' +
      (erc721Config.contractType as string).substring(2) +
      (erc721Config.chainType as string).substring(2) +
      (erc721Config.salt as string).substring(2) +
      web3.utils.keccak256(erc721Config.byteCode as string).substring(2) +
      web3.utils.keccak256(erc721Config.initCode as string).substring(2) +
      (deployer as string).substring(2)
  );
  let erc721ConfigHashBytes: number[] = web3.utils.hexToBytes(erc721ConfigHash);
  return {
    erc721Config,
    erc721ConfigHash,
    erc721ConfigHashBytes,
  } as Erc721Config;
};

export interface Erc20Config {
  erc20Config: DeploymentConfigStruct;
  erc20ConfigHash: BytesLike;
  erc20ConfigHashBytes: number[];
}
const generateErc20Config = async function (
  network: Network,
  deployer: BytesLike,
  contractName: string,
  tokenName: string,
  tokenSymbol: string,
  domainSeperator: string,
  domainVersion: string,
  decimals: BigNumberish,
  eventConfig: BytesLike,
  initCode: BytesLike,
  salt: BytesLike
): Promise<Erc20Config> {
  let hre: LeanHardhatRuntimeEnvironment;
  if (typeof global.__hreL1 === 'undefined') {
    throw new Error('LeanHardhatRuntimeEnvironment has not been cached yet.');
  } else {
    hre = global.__hreL1 as LeanHardhatRuntimeEnvironment;
  }
  let chainId: string = '0x' + network.holographId.toString(16).padStart(8, '0');
  let erc20Hash: string = '0x' + web3.utils.asciiToHex('HolographERC20').substring(2).padStart(64, '0');
  let artifact: ContractFactory = await hre.ethers.getContractFactory(contractName);
  let erc20Config: DeploymentConfigStruct = {
    contractType: erc20Hash,
    chainType: chainId,
    salt: salt,
    byteCode: artifact.bytecode,
    initCode: generateInitCode(
      ['string', 'string', 'uint8', 'uint256', 'string', 'string', 'bool', 'bytes'],
      [
        tokenName, // string memory tokenName
        tokenSymbol, // string memory tokenSymbol
        decimals, // uint8 decimals
        eventConfig, // uint256 eventConfig
        domainSeperator,
        domainVersion,
        false, // bool skipInit
        initCode,
      ]
    ),
  };
  let erc20ConfigHash: BytesLike = web3.utils.keccak256(
    '0x' +
      (erc20Config.contractType as string).substring(2) +
      (erc20Config.chainType as string).substring(2) +
      (erc20Config.salt as string).substring(2) +
      web3.utils.keccak256(erc20Config.byteCode as string).substring(2) +
      web3.utils.keccak256(erc20Config.initCode as string).substring(2) +
      (deployer as string).substring(2)
  );
  let erc20ConfigHashBytes: number[] = web3.utils.hexToBytes(erc20ConfigHash);
  return {
    erc20Config,
    erc20ConfigHash,
    erc20ConfigHashBytes,
  } as Erc20Config;
};

const getHolographedContractHash = async function (
  deployer: string,
  contractName: string,
  contractType: string,
  chainId: string,
  salt: string,
  initCode: string
): Promise<BytesLike> {
  const hre: HardhatRuntimeEnvironment = require('hardhat');
  const artifact: ContractFactory = await hre.ethers.getContractFactory(contractName);
  const contractHash = '0x' + web3.utils.asciiToHex(contractType).substring(2).padStart(64, '0');
  const config = [
    contractHash, // bytes32 contractType
    chainId, // uint32 chainType
    salt, // bytes32 salt
    artifact.bytecode, // bytes byteCode
    initCode, // bytes initCode
  ];
  const hash = web3.utils.hexToBytes(
    web3.utils.keccak256(
      '0x' +
        config[0].substring(2) +
        config[1].substring(2) +
        config[2].substring(2) +
        web3.utils.keccak256(config[3]).substring(2) +
        web3.utils.keccak256(config[4]).substring(2) +
        deployer.substring(2)
    )
  );
  return hash;
};

const sleep = async function (ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const getGasUsage = async function (
  hre: LeanHardhatRuntimeEnvironment,
  description: string = '',
  verbose: boolean = false
): Promise<BigNumber> {
  let blockNumber: number = await hre.ethers.provider.getBlockNumber();
  let transactionHash = (await hre.ethers.provider.getBlockWithTransactions(blockNumber)).transactions[0].hash;
  let transaction = await hre.ethers.provider.getTransactionReceipt(transactionHash);
  let gasUsed: BigNumber = transaction.cumulativeGasUsed;
  if (verbose) {
    process.stdout.write('\n          ' + description + ' gas used: ' + gasUsed.toString() + '\n');
  }
  return gasUsed;
};

export {
  isDefined,
  bytesToHex,
  hexToBytes,
  stringToHex,
  randomHex,
  StrictECDSA,
  l2Ethers,
  hreSplit,
  functionHash,
  XOR,
  buildDomainSeperator,
  generateInitCode,
  generateDeployCode,
  zeroAddress,
  isContractDeployed,
  genesisDeriveFutureAddress,
  genesisDeployHelper,
  utf8ToBytes32,
  ZERO_ADDRESS,
  remove0x,
  sha256,
  generateErc721Config,
  generateErc20Config,
  getHolographedContractHash,
  sleep,
  getGasUsage,
};
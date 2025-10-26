// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6;

import '@arcologynetwork/concurrentlib/lib/runtime/Runtime.sol';

contract TestRuntimePid {
    event PidResult(bool success, uint256 pidLength, bytes32 pidValue);
    
    function testGetPid() external {
        bytes memory pidBytes = Runtime.pid();
        uint256 length = pidBytes.length;
        bytes32 pidValue;
        bool success = false;
        
        if (length > 0) {
            success = true;
            pidValue = abi.decode(pidBytes, (bytes32));
        }
        
        emit PidResult(success, length, pidValue);
    }
}

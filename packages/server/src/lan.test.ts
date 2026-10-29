// packages/server/src/lan.test.ts
import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import {
  formatHttpsUrl,
  listLanIpv4Addresses,
  type NetworkInterfaceMap,
} from "./lan";

function info(
  address: string,
  family: "IPv4" | "IPv6" = "IPv4",
  internal = false,
): NetworkInterfaceInfo {
  if (family === "IPv6") {
    return {
      address,
      netmask: "ffff:ffff:ffff:ffff::",
      family: "IPv6",
      mac: "00:00:00:00:00:00",
      internal,
      cidr: `${address}/64`,
      scopeid: 0,
    };
  }
  return {
    address,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal,
    cidr: `${address}/24`,
  };
}

describe("listLanIpv4Addresses", () => {
  it("returns joinable IPv4 addresses sorted numerically and deduplicated", () => {
    const interfaces: NetworkInterfaceMap = {
      loopback: [info("127.0.0.1", "IPv4", true)],
      ethernet: [info("192.168.1.20"), info("fe80::1", "IPv6")],
      wifi: [info("10.0.0.5")],
      virtual: [info("192.168.1.20"), info("169.254.10.10")],
      "vEthernet (WSL)": [info("172.20.0.1")],
    };

    expect(listLanIpv4Addresses(interfaces)).toEqual([
      "10.0.0.5",
      "172.20.0.1",
      "192.168.1.20",
    ]);
  });

  it("returns an empty list when no adapter qualifies", () => {
    expect(
      listLanIpv4Addresses({
        loopback: [info("127.0.0.1", "IPv4", true)],
        linkLocal: [info("169.254.1.2")],
        empty: undefined,
      }),
    ).toEqual([]);
  });
});

describe("formatHttpsUrl", () => {
  it("formats hostnames and IPv4 addresses", () => {
    expect(formatHttpsUrl("localhost", 8443)).toBe("https://localhost:8443");
    expect(formatHttpsUrl("192.168.1.20", 8443)).toBe(
      "https://192.168.1.20:8443",
    );
  });

  it("brackets IPv6 literals", () => {
    expect(formatHttpsUrl("::1", 8443)).toBe("https://[::1]:8443");
  });
});

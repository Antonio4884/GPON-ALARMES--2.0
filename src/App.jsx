import React, { useState } from 'react';

function detectarGerencia(linhas) {
  for (const linha of linhas) {
    const l = linha.toLowerCase();

    if (l.includes('pon port:') && l.includes('.lt') && l.includes('.pon')) return 'PRIMARIA_CSV';
    if (l.includes('ont:') && l.includes('.lt') && l.includes('.pon')) return 'AMS';
    if (l.includes('ethernet lt port:')) return 'AMS_SFP';
    if (l.includes('frame=') && l.includes('slot=') && l.includes('port=')) return 'IMASTER';
    if (l.includes('onuid')) return 'IMASTER';
    if (l.includes('zte') || l.includes('c600') || l.includes('rack=')) return 'ZTE';

    if (
      linha.includes('\t') &&
      (
        l.includes('off line') ||
        l.includes('link loss') ||
        l.includes('link_loss') ||
        l.includes('/gcob[') ||
        l.includes('/pon')
      )
    ) {
      return 'UNM2000';
    }
  }

  return 'IMASTER';
}

function extrairPrimariaCsv(linhas) {
  return linhas
    .map((linha) => {
      const match = linha.match(/PON Port:([^,]+)/i);
      return match ? match[1] : null;
    })
    .filter(Boolean)
    .join('\n');
}

function extrairOntsAms(linhas) {
  return linhas
    .map((linha) => {
      const match = linha.match(/ONT:[^,\s]+/);
      return match ? match[0] : null;
    })
    .filter(Boolean)
    .join('\n');
}

function extrairSfpAms(linhas) {
  return linhas
    .map((linha) => {
      const match = linha.match(/Ethernet LT Port:([^,]+,SFP)/);
      return match ? match[1] : null;
    })
    .filter(Boolean)
    .join('\n');
}

function formatarData(dataTexto) {
  if (!dataTexto) return '';

  const match = dataTexto.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return '';

  return `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}`;
}

function gerarTicketsTexto(gerencia, linhas) {
  const data = new Date().toLocaleString('pt-BR');
  let resultadoFinal = '';

  const falhaPrimaria = linhas.some((linha) =>
    linha.toLowerCase().includes('the feeder fiber is broken')
  );

  if (falhaPrimaria) {
    let olt = '';
    let interfaces = [];
    let totalCircuitos = 0;

    linhas.forEach((linha) => {
      const oltMatch = linha.match(/(olt[^\s,\t]+)/i);
      const slotMatch = linha.match(/Slot=(\d+)/i);
      const portMatch = linha.match(/Port=(\d+)/i);
      const afetadosMatch = linha.match(/The number of affected ONTs=(\d+)/i);

      if (oltMatch) olt = oltMatch[1];
      if (slotMatch && portMatch) interfaces.push(`${slotMatch[1]}/${portMatch[1]}`);
      if (afetadosMatch) totalCircuitos += Number(afetadosMatch[1]);
    });

    interfaces = [...new Set(interfaces)];

    resultadoFinal += `-:CARIMBO DE ABERTURA - NOC:-.
Falha: Falha em rede Primaria, OLT: ${olt}
Hora/data: ${data}
Equipamento: OLT: ${olt}

Interface: ${interfaces.join(', ')}
Circuitos afetados: ${totalCircuitos}

Fone NOC 3318-7890

`;

    interfaces.forEach((item) => {
      const [slot, port] = item.split('/');
      resultadoFinal += `Slot:${slot}/Port:${port}\n`;
    });

    resultadoFinal += '\n\n';
  }

  if (gerencia === 'IMASTER') {
    const agrupado = {};
    const equipamentos = new Set();
    let totalCircuitos = 0;

    linhas.forEach((linha) => {
      if (!linha.toLowerCase().includes('distribute fiber')) return;

      const oltMatch = linha.match(/(olt[^\s,\t]+)/i);
      const slotMatch = linha.match(/Slot=(\d+)/i);
      const portMatch = linha.match(/Port=(\d+)/i);
      const onuMatch = linha.match(/ONUID=(\d+)/i);
      const contratoMatch = linha.match(
        /Description of the ONT\(only for NMS\)=(\d+)|ONT Password=(\d+)/i
      );

      if (!oltMatch || !slotMatch || !portMatch || !onuMatch) return;

      const olt = oltMatch[1];
      const slot = slotMatch[1];
      const port = portMatch[1];
      const onu = onuMatch[1];
      const contrato = contratoMatch
        ? contratoMatch[1] || contratoMatch[2] || 'NCE'
        : 'NCE';

      equipamentos.add(olt);
      totalCircuitos++;

      const chave = `${olt}-${slot}-${port}`;

      if (!agrupado[chave]) {
        agrupado[chave] = { olt, slot, port, clientes: [] };
      }

      agrupado[chave].clientes.push({ onu, contrato });
    });

    if (totalCircuitos > 0) {
      resultadoFinal += `-:CARIMBO DE ABERTURA - NOC:-.
Falha em rede Secundaria OLT: ${Array.from(equipamentos)[0]} - circuitos afetados: ${totalCircuitos}
Equipamento: ${Array.from(equipamentos).join(', ')}
Alarme: loss
Data/Hora: ${data} BRT


`;
    }

    Object.values(agrupado).forEach((grupo) => {
      resultadoFinal += `${grupo.olt} - ${grupo.slot}/${grupo.port}\n`;

      grupo.clientes
        .sort((a, b) => Number(a.onu) - Number(b.onu))
        .forEach((cliente) => {
          resultadoFinal += `ONU ${cliente.onu} - Contrato ${cliente.contrato}\n`;
        });

      resultadoFinal += '\n';
    });

    return resultadoFinal.trim();
  }

  if (gerencia === 'UNM2000') {
    const agrupado = {};
    const primarias = [];

    linhas.forEach((linha) => {
      const matchPrimaria = linha.match(/([A-Z0-9\-]+)\/GCOB\[(\d+)\]\/PON(\d+)\s*$/i);

      if (matchPrimaria) {
        primarias.push({
          olt: `OLT1-PR-${matchPrimaria[1]}`,
          slot: matchPrimaria[2],
          port: matchPrimaria[3]
        });
        return;
      }

      const matchNovo = linha.match(
        /([A-Z0-9\-]+)\/GCOB\[(\d+)\]\/PON(\d+)\/(\d+)[^:]*:\[(\d+)\]/i
      );

      if (matchNovo) {
        const colunas = linha.split('\t');
        const dataLinha = formatarData(colunas[16] || '');

        const olt = `OLT1-PR-${matchNovo[1]}`;
        const slot = matchNovo[2];
        const port = matchNovo[3];
        const contrato = matchNovo[4];
        const onu = matchNovo[5];

        const chave = `${olt}-${slot}-${port}`;

        if (!agrupado[chave]) {
          agrupado[chave] = {
            olt,
            slot,
            port,
            data: dataLinha,
            clientes: []
          };
        }

        agrupado[chave].clientes.push({ onu, contrato });
      }
    });

    primarias.forEach((p) => {
      resultadoFinal += `-:CARIMBO DE ABERTURA - NOC:-.
Falha:  Sercomtel - Primaria :${p.olt} - ${p.slot}/${p.port} - Circuitos Afetados:  
Hora/data: 
Alarme: LOSS
IP: N/A
Interface: ${p.olt} - ${p.slot}/${p.port} - Primaria 

Interface: ${p.slot}/${p.port}


`;
    });

    Object.values(agrupado).forEach((grupo) => {
      resultadoFinal += `-:CARIMBO DE ABERTURA - NOC:-.
Falha:  - Sercomtel - Secundaria :${grupo.olt}- ${grupo.slot}/${grupo.port} - Circuitos Afetados: 
Hora/data: ${grupo.data}
Alarme: LOSS
IP: N/A
Interface:${grupo.olt}- ${grupo.slot}/${grupo.port} - Secundaria

`;

      grupo.clientes
        .sort((a, b) => Number(a.onu) - Number(b.onu))
        .forEach((cliente) => {
          resultadoFinal += `ONU ${cliente.onu} - Contrato ${cliente.contrato}\n`;
        });

      resultadoFinal += '\n';
    });

    return resultadoFinal.trim();
  }

  if (gerencia === 'ZTE') {
    const agrupado = {};
    const primarias = [];

    linhas.forEach((linha) => {
      const secMatch = linha.match(
        /(olt[^\s\t]+).*RACK=\d+,SHELF=\d+,SLOT=(\d+),PORT=(\d+),ONU=(\d+).*ONU Name=(\d+)/i
      );

      if (secMatch) {
        const [_, olt, slot, port, onu, contrato] = secMatch;
        const chave = `${olt}-${slot}-${port}`;

        if (!agrupado[chave]) {
          agrupado[chave] = { olt, slot, port, clientes: [] };
        }

        agrupado[chave].clientes.push({ onu, contrato });
        return;
      }

      const primMatch = linha.match(
        /(olt[^\s\t]+).*RACK=\d+,SHELF=\d+,SLOT=(\d+),PORT=(\d+)(?!,ONU=)/i
      );

      if (primMatch) {
        primarias.push({
          olt: primMatch[1],
          slot: primMatch[2],
          port: primMatch[3]
        });
      }
    });

    primarias.forEach((p) => {
      resultadoFinal += `-:CARIMBO DE ABERTURA - NOC:-.
Falha:  - NOVA -Falha em rede Primaria, OLT:   ${p.olt} - ${p.slot}/${p.port} - circuitos afetados:  
Hora/data: 
Equipamento: OLT:   ${p.olt} - ${p.slot}/${p.port}
Alarme: LOSS
IP: N/A
Interface:  ${p.olt} - ${p.slot}/${p.port} - Primaria
Fone NOC 3318-7890


${p.olt}
SLOT ${p.slot} / PON ${p.port}

`;
    });

    Object.values(agrupado).forEach((grupo) => {
      resultadoFinal += `-:CARIMBO DE ABERTURA - NOC:-.
Falha:  - NOVA -Falha em rede Secundaria, OLT:  OLT: ${grupo.olt} - ${grupo.slot}/${grupo.port} - circuitos afetados: ${grupo.clientes.length}
Hora/data:  
Equipamento: OLT:   ${grupo.olt} - ${grupo.slot}/${grupo.port}
Alarme: LOSS
IP: N/A
Interface:   ${grupo.olt} - ${grupo.slot}/${grupo.port} - Secundaria


`;

      grupo.clientes
        .sort((a, b) => Number(a.onu) - Number(b.onu))
        .forEach((cliente) => {
          resultadoFinal += `ONU ${cliente.onu} - Contrato ${cliente.contrato}\n`;
        });

      resultadoFinal += '\n';
    });

    return resultadoFinal.trim();
  }

  return resultadoFinal || 'Nenhum alarme reconhecido.';
}

function processarTexto(texto) {
  const linhas = texto.split('\n').filter(Boolean);
  const gerencia = detectarGerencia(linhas);

  if (gerencia === 'AMS') return extrairOntsAms(linhas);
  if (gerencia === 'AMS_SFP') return extrairSfpAms(linhas);
  if (gerencia === 'PRIMARIA_CSV') return extrairPrimariaCsv(linhas);

  return gerarTicketsTexto(gerencia, linhas);
}

export default function App() {
  const [entrada, setEntrada] = useState('');
  const [resultado, setResultado] = useState('');

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial', maxWidth: '1000px', margin: '0 auto' }}>
      <h1>🔧 Huawei, UNM2000, AMS5520 e ZTE</h1>

      <textarea
        value={entrada}
        onChange={(e) => setEntrada(e.target.value)}
        placeholder="Cole os alarmes aqui..."
        style={{ width: '100%', height: '250px', padding: '10px', marginBottom: '10px' }}
      />

      <div style={{ marginBottom: '10px' }}>
        <button
          onClick={() => setResultado(processarTexto(entrada))}
          style={{ marginRight: '10px', padding: '10px 20px' }}
        >
          Gerar Alarme
        </button>

        <button
          onClick={() => {
            setEntrada('');
            setResultado('');
          }}
          style={{ padding: '10px 20px' }}
        >
          Limpar
        </button>
      </div>

      <textarea
        value={resultado}
        readOnly
        placeholder="Resultado aparecerá aqui..."
        style={{ width: '100%', height: '250px', padding: '10px' }}
      />
    </div>
  );
}
